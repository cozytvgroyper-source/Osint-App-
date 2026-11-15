// Tests for the menu-bar controller's logic (Core.swift). Built and run by tests/menu-bar-controller.test.mjs:
//   swiftc -swift-version 5 Core.swift main.swift (this file is main.swift, so it runs top to bottom).
// It needs no XCTest, so Apple's command line tools are enough. Exits non-zero if any check fails.

import Foundation

// A child copy of this program can hold an instance lock until it is killed, to simulate a crashed controller.
if CommandLine.arguments.count == 3, CommandLine.arguments[1] == "hold-lock" {
    let lock = InstanceLock(path: CommandLine.arguments[2])
    guard lock.acquire() else { exit(3) }
    print("held")
    fflush(stdout)
    while true { sleep(60) }
}

var failures = 0
var checks = 0
var currentTest = ""

func test(_ name: String, _ body: () throws -> Void) {
    currentTest = name
    do { try body() } catch { fail("threw \(error)") }
}

func fail(_ message: String, line: Int = #line) {
    failures += 1
    print("FAIL [\(currentTest)] line \(line): \(message)")
}

func expect(_ condition: Bool, _ message: @autoclosure () -> String = "", line: Int = #line) {
    checks += 1
    if !condition { fail(message(), line: line) }
}

func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String = "", line: Int = #line) {
    checks += 1
    if actual != expected { fail("\(message.isEmpty ? "" : message + ": ")expected \(expected), got \(actual)", line: line) }
}

// MARK: Fixtures

func statusJSON(_ states: [String], action: String = "") -> String {
    let ids = ["headless", "mcp", "osint-toolbox", "omega", "signaldesk"]
    let names = ["Open OSINT data", "Open OSINT tools", "OSINT Toolbox", "Omega tools", "Public Desk"]
    let ready = states.filter { $0 == "ready" }.count
    let running = states.filter { $0 != "stopped" }.count
    let overall = ready == 5 ? "ready" : running == 0 ? "stopped" : "partial"
    let services = zip(zip(ids, names), states).map { pair, state in
        "{\"id\":\"\(pair.0)\",\"name\":\"\(pair.1)\",\"state\":\"\(state)\"}"
    }
    return "{\"overall\":\"\(overall)\",\"ready\":\(ready),\"action\":\"\(action)\",\"services\":[\(services.joined(separator: ","))]}"
}

let allReady = statusJSON(Array(repeating: "ready", count: 5))
let allStopped = statusJSON(Array(repeating: "stopped", count: 5))
let omegaDown = statusJSON(["ready", "ready", "ready", "stopped", "ready"])

func ok(_ output: String) -> CommandResult { CommandResult(exitCode: 0, output: output) }

final class FakeRunner: CommandRunning {
    var calls: [[String]] = []
    var status = allStopped
    var actionResult = CommandResult(exitCode: 0, output: "Public Desk is ready.")

    func run(_ arguments: [String], timeout: TimeInterval) -> CommandResult {
        calls.append(arguments)
        return arguments.first == "status" && arguments.contains("--json") ? ok(status) : actionResult
    }

    var actionCalls: [[String]] { calls.filter { $0 != ["status", "--json"] } }
}

struct ImmediateScheduling: Scheduling {
    func background(_ work: @escaping () -> Void) { work() }
    func main(_ work: @escaping () -> Void) { work() }
}

/// Holds background work until released, to observe the controller while a command is still running.
final class DeferredScheduling: Scheduling {
    var pending: [() -> Void] = []
    func background(_ work: @escaping () -> Void) { pending.append(work) }
    func main(_ work: @escaping () -> Void) { work() }
    func drain() { while !pending.isEmpty { pending.removeFirst()() } }
}

func makeController(_ runner: FakeRunner, scheduler: Scheduling = ImmediateScheduling()) -> (Controller, () -> [Notice]) {
    let controller = Controller(runner: runner, scheduler: scheduler)
    var notices: [Notice] = []
    controller.onNotice = { notices.append($0) }
    return (controller, { notices })
}

func temporaryFolder() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("pd-controller-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

// MARK: Status parsing and state mapping

test("parses the control script's JSON status, ignoring earlier lines") {
    let snapshot = StatusSnapshot.parse("Cleared a lock left by an earlier start.\n" + omegaDown + "\n")
    expectEqual(snapshot?.overall, "partial")
    expectEqual(snapshot?.ready, 4)
    expectEqual(snapshot?.services.count, 5)
    expectEqual(snapshot?.services[3].name, "Omega tools")
    expect(StatusSnapshot.parse("Overall: Ready") == nil, "plain text is not a status")
    expect(StatusSnapshot.parse("") == nil, "empty output is not a status")
}

test("maps service states to green, yellow and red") {
    var state = ControllerState()
    expectEqual(state.health, .yellow)
    expectEqual(state.headline, "Checking…")
    _ = state.apply(status: ok(allReady))
    expectEqual(state.health, .green)
    expectEqual(state.headline, "Ready")
    _ = state.apply(status: ok(allStopped))
    expectEqual(state.health, .red)
    expectEqual(state.headline, "Stopped")

    var partial = ControllerState()
    _ = partial.apply(status: ok(statusJSON(["ready", "ready", "starting", "stopped", "ready"])))
    expectEqual(partial.health, .yellow)
    expectEqual(partial.headline, "Partially available (3 of 5 ready)")

    var external = ControllerState()
    _ = external.apply(status: ok(statusJSON(["ready", "starting", "stopped", "stopped", "stopped"], action: "start")))
    expectEqual(external.health, .yellow)
    expectEqual(external.headline, "Starting…")
    _ = external.apply(status: ok(statusJSON(["ready", "ready", "ready", "ready", "ready"], action: "stop")))
    expectEqual(external.headline, "Stopping…")
}

test("shows red when status cannot be read") {
    var state = ControllerState()
    _ = state.apply(status: CommandResult(exitCode: 1, output: "zsh: permission denied"))
    expectEqual(state.health, .red)
    expectEqual(state.headline, "zsh: permission denied")
    _ = state.apply(status: ok(allReady))
    expectEqual(state.health, .green)
}

test("lists each service's state for the Status menu") {
    var state = ControllerState()
    expectEqual(state.serviceLines(), ["Status not checked yet"])
    _ = state.apply(status: ok(statusJSON(["ready", "starting", "stopped", "ready", "ready"])))
    expectEqual(state.serviceLines(), ["Open OSINT data: Ready", "Open OSINT tools: Starting or not responding",
                                       "OSINT Toolbox: Stopped", "Omega tools: Ready", "Public Desk: Ready"])
}

// MARK: Menu actions and command execution

test("each menu action runs the matching control-script command") {
    let runner = FakeRunner()
    let (controller, _) = makeController(runner)
    controller.refresh()
    controller.choose(.open)
    controller.choose(.start)
    controller.choose(.restart)
    runner.status = allReady
    controller.refresh()
    controller.choose(.stop)
    controller.choose(.status)
    controller.choose(.diagnostics)
    expectEqual(runner.actionCalls, [["start", "--open"], ["start"], ["restart"], ["stop"], ["status"], ["diagnostics", "--open"]])
}

test("Open only opens the browser when every service is ready") {
    let runner = FakeRunner()
    runner.status = allReady
    let (controller, _) = makeController(runner)
    controller.refresh()
    controller.choose(.open)
    expectEqual(runner.actionCalls, [["open"]])
}

test("Quit Controller never stops services") {
    let runner = FakeRunner()
    runner.status = allReady
    let (controller, _) = makeController(runner)
    controller.refresh()
    controller.choose(.quit)
    expectEqual(runner.actionCalls, [])
    expectEqual(controller.state.health, .green)
}

test("Stop is unavailable when everything is already stopped") {
    let runner = FakeRunner()
    let (controller, _) = makeController(runner)
    controller.refresh()
    expect(!controller.state.isEnabled(.stop), "Stop should be disabled")
    controller.choose(.stop)
    expectEqual(runner.actionCalls, [])
    expect(controller.state.isEnabled(.start), "Start should be enabled")
}

test("Status and Diagnostics show the script's text") {
    let runner = FakeRunner()
    runner.actionResult = ok("Public Desk: Ready\nOverall: Ready\n")
    let (controller, _) = makeController(runner)
    var shown: [String] = []
    controller.onText = { title, text in shown.append("\(title)|\(text)") }
    controller.choose(.status)
    expectEqual(shown, ["Public Desk status|Public Desk: Ready\nOverall: Ready"])
}

test("runs the real control script and reports its exit code, output and timeout") {
    let root = temporaryFolder()
    defer { try? FileManager.default.removeItem(at: root) }
    let scripts = root.appendingPathComponent("scripts")
    try FileManager.default.createDirectory(at: scripts, withIntermediateDirectories: true)
    let script = scripts.appendingPathComponent("public-desk-control.zsh")
    try """
    case "$1" in
      start) print -r -- "Starting…"; print -u2 -- "Omega tools did not become ready."; exit 1 ;;
      slow) sleep 30 ;;
      path) print -r -- "$PATH|$PWD" ;;
      *) print -r -- "ran $*" ;;
    esac
    """.write(to: script, atomically: true, encoding: .utf8)
    let log = root.appendingPathComponent("menu-bar.log")
    let runner = ScriptRunner(script: script, searchPath: "/custom/bin:/usr/bin:/bin", logFile: log)

    let failed = runner.run(["start"], timeout: 10)
    expectEqual(failed.exitCode, 1)
    expectEqual(failed.lastLine, "Omega tools did not become ready.")
    expect(failed.output.contains("Starting…"), "standard output is kept")

    let fine = runner.run(["stop", "--now"], timeout: 10)
    expect(fine.succeeded, "exit 0 succeeds")
    expectEqual(fine.lastLine, "ran stop --now")

    let environment = runner.run(["path"], timeout: 10)
    expect(environment.lastLine.hasPrefix("/custom/bin:/usr/bin:/bin|"), "the app's search path is used")
    expect(environment.lastLine.hasSuffix("/\(root.lastPathComponent)"), "runs from the Public Desk folder")

    let started = Date()
    let slow = runner.run(["slow"], timeout: 1)
    expectEqual(slow.exitCode, 124)
    expect(Date().timeIntervalSince(started) < 10, "a hung script is stopped at its timeout")

    let logged = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
    expect(logged.contains("start → exit 1") && logged.contains("stop --now → exit 0"), "actions are logged")
    _ = runner.run(["status", "--json"], timeout: 10)
    let afterStatus = (try? String(contentsOf: log, encoding: .utf8)) ?? ""
    expect(!afterStatus.contains("status --json"), "status polls are not logged")
}

test("a missing control script fails cleanly instead of crashing") {
    let runner = ScriptRunner(script: URL(fileURLWithPath: "/nonexistent/scripts/public-desk-control.zsh"),
                              searchPath: "/usr/bin:/bin", logFile: nil)
    let result = runner.run(["status", "--json"], timeout: 5)
    expect(!result.succeeded, "should fail")
    var state = ControllerState()
    _ = state.apply(status: result)
    expectEqual(state.health, .red)
}

// MARK: Duplicate prevention

test("a second action is refused while one is running") {
    let runner = FakeRunner()
    let scheduler = DeferredScheduling()
    let (controller, _) = makeController(runner, scheduler: scheduler)
    expect(controller.perform(.start), "first start begins")
    expect(!controller.perform(.start), "second start is refused")
    expect(!controller.perform(.restart), "restart is refused while starting")
    expectEqual(controller.state.health, .yellow)
    expectEqual(controller.state.headline, "Starting…")
    for command in [MenuCommand.open, .start, .stop, .restart] {
        expect(!controller.state.isEnabled(command), "\(command) disabled while starting")
    }
    expect(controller.state.isEnabled(.quit) && controller.state.isEnabled(.status), "Quit and Status stay available")
    scheduler.drain()
    expectEqual(runner.actionCalls, [["start"]])
}

test("actions are refused while a Finder launcher is starting or stopping Public Desk") {
    var state = ControllerState()
    _ = state.apply(status: ok(statusJSON(["ready", "starting", "stopped", "stopped", "stopped"], action: "start")))
    expect(!state.begin(.start), "start refused during another launcher's start")
    expect(!state.isEnabled(.stop), "stop disabled")
    _ = state.apply(status: ok(allReady))
    expect(state.begin(.stop), "stop allowed once it finishes")
}

test("overlapping status checks are skipped, not stacked") {
    let runner = FakeRunner()
    let scheduler = DeferredScheduling()
    let (controller, _) = makeController(runner, scheduler: scheduler)
    controller.refresh()
    controller.refresh()
    controller.refresh()
    expectEqual(scheduler.pending.count, 1)
    scheduler.drain()
    controller.refresh()
    expectEqual(scheduler.pending.count, 1)
}

test("periodic status checks never start, stop or restart anything") {
    let runner = FakeRunner()
    runner.status = omegaDown
    let (controller, _) = makeController(runner)
    for _ in 0..<20 { controller.refresh() }
    expectEqual(runner.actionCalls, [])
    expect(runner.calls.allSatisfy { $0 == ["status", "--json"] }, "only status was run")
}

test("only one controller can hold the instance lock") {
    let folder = temporaryFolder()
    defer { try? FileManager.default.removeItem(at: folder) }
    let path = folder.appendingPathComponent("nested/menu-bar.lock").path
    let first = InstanceLock(path: path)
    let second = InstanceLock(path: path)
    expect(first.acquire(), "first acquires (creating its folder)")
    expect(!second.acquire(), "second is refused")
    first.release()
    expect(second.acquire(), "second acquires after the first quits")
    second.release()
}

// MARK: Stale-lock recovery

test("a lock file left behind with no running owner is reused") {
    let folder = temporaryFolder()
    defer { try? FileManager.default.removeItem(at: folder) }
    let path = folder.appendingPathComponent("menu-bar.lock").path
    try "99999\nleft by a crash\n".write(toFile: path, atomically: true, encoding: .utf8)
    let lock = InstanceLock(path: path)
    expect(lock.acquire(), "stale lock file is reused")
    expectEqual(try String(contentsOfFile: path, encoding: .utf8), "\(getpid())\n")
    lock.release()
}

test("the lock is recovered after the controller holding it is killed") {
    let folder = temporaryFolder()
    defer { try? FileManager.default.removeItem(at: folder) }
    let path = folder.appendingPathComponent("menu-bar.lock").path
    let child = Process()
    child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    child.arguments = ["hold-lock", path]
    let pipe = Pipe()
    child.standardOutput = pipe
    try child.run()
    let line = String(data: pipe.fileHandleForReading.availableData, encoding: .utf8) ?? ""
    expectEqual(line.trimmingCharacters(in: .whitespacesAndNewlines), "held")
    let lock = InstanceLock(path: path)
    expect(!lock.acquire(), "refused while the other controller runs")
    kill(child.processIdentifier, SIGKILL)
    child.waitUntilExit()
    expect(lock.acquire(), "acquired after the other controller crashed")
    lock.release()
}

// MARK: Failure handling and notifications

test("a successful start notifies once and turns green") {
    let runner = FakeRunner()
    let (controller, notices) = makeController(runner)
    controller.refresh()
    runner.status = allReady
    controller.perform(.start)
    expectEqual(notices(), [Notice(title: "Public Desk is ready", body: "All five services are running.")])
    expectEqual(controller.state.health, .green)
}

test("a failed start shows red with the script's reason until the next action") {
    let runner = FakeRunner()
    runner.actionResult = CommandResult(exitCode: 1, output: "Starting Omega tools…\nOmega tools did not become ready.\n")
    runner.status = omegaDown
    let (controller, notices) = makeController(runner)
    controller.perform(.start)
    expectEqual(notices(), [Notice(title: "Public Desk could not start", body: "Omega tools did not become ready.")])
    expectEqual(controller.state.health, .red)
    expectEqual(controller.state.headline, "Start failed")
    controller.refresh()
    expectEqual(controller.state.health, .red)
    expect(controller.state.isEnabled(.start), "Start can retry")

    runner.actionResult = ok("Public Desk is ready.")
    runner.status = allReady
    controller.perform(.start)
    expectEqual(controller.state.health, .green)
}

test("a failed stop is reported") {
    var state = ControllerState()
    _ = state.apply(status: ok(allReady))
    expect(state.begin(.stop))
    let notices = state.finish(.stop, CommandResult(exitCode: 1, output: "Could not stop omega."))
    expectEqual(notices, [Notice(title: "Public Desk could not stop", body: "Could not stop omega.")])
    expectEqual(state.health, .red)
}

test("a failure with no output still explains itself") {
    var state = ControllerState()
    expect(state.begin(.start))
    let notices = state.finish(.start, CommandResult(exitCode: 2, output: ""))
    expectEqual(notices.first?.body, "The control script exited with code 2.")
}

test("a ready service that stops on its own is reported once and shown as failed") {
    let runner = FakeRunner()
    runner.status = allReady
    let (controller, notices) = makeController(runner)
    controller.refresh()
    runner.status = omegaDown
    controller.refresh()
    controller.refresh()
    expectEqual(notices(), [Notice(title: "Omega tools stopped", body: "Choose Start to bring it back.")])
    expectEqual(controller.state.health, .red)
    expectEqual(controller.state.headline, "Omega tools is unavailable")

    // Recovering the one missing service with Start turns the icon green again.
    runner.status = allReady
    controller.perform(.start)
    expectEqual(controller.state.health, .green)
}

test("several services stopping at once are reported together") {
    var state = ControllerState()
    _ = state.apply(status: ok(allReady))
    let notices = state.apply(status: ok(statusJSON(["ready", "ready", "stopped", "stopped", "ready"])))
    expectEqual(notices, [Notice(title: "2 Public Desk services stopped", body: "Choose Start to bring them back.")])
}

test("services going down during a start, stop or Finder launcher action are not failures") {
    var own = ControllerState()
    _ = own.apply(status: ok(allReady))
    expect(own.begin(.restart))
    expectEqual(own.apply(status: ok(omegaDown)), [])

    var external = ControllerState()
    _ = external.apply(status: ok(allReady))
    expectEqual(external.apply(status: ok(statusJSON(["ready", "ready", "ready", "stopped", "stopped"], action: "stop"))), [])

    var stopped = ControllerState()
    _ = stopped.apply(status: ok(allReady))
    // A full stop (e.g. Stop Public Desk.command between two checks) is not a crash.
    expectEqual(stopped.apply(status: ok(allStopped)), [])
    expectEqual(stopped.headline, "Stopped")
}

// MARK: Self-update

let oldHash = String(repeating: "a", count: 64)
let newHash = String(repeating: "b", count: 64)

final class FakeBuild: CommandRunning {
    var calls: [[String]] = []
    var hash = newHash
    var build = CommandResult(exitCode: 0, output: "Installed")
    func run(_ arguments: [String], timeout: TimeInterval) -> CommandResult {
        calls.append(arguments)
        return arguments == ["--source-hash"] ? ok(hash + "\n") : build
    }
    var builds: [[String]] { calls.filter { $0 != ["--source-hash"] } }
}

func makeUpdater(_ build: FakeBuild, busy: Bool = false, scheduler: Scheduling = ImmediateScheduling()) -> (SelfUpdater, () -> [Notice]) {
    let updater = SelfUpdater(runner: build, scheduler: scheduler, installedHash: oldHash,
                              destination: "/Users/test/Applications", isBusy: { busy })
    var notices: [Notice] = []
    updater.onNotice = { notices.append($0) }
    updater.onInstalled = { true }
    return (updater, { notices })
}

test("an up-to-date controller does not rebuild") {
    let build = FakeBuild()
    build.hash = oldHash
    let (updater, notices) = makeUpdater(build)
    updater.check()
    updater.check()
    expectEqual(build.builds, [])
    expectEqual(updater.status, .upToDate)
    expectEqual(notices(), [])
}

test("a changed source rebuilds into the folder the app is installed in") {
    let build = FakeBuild()
    let (updater, notices) = makeUpdater(build)
    var handedOver = 0
    updater.onInstalled = { handedOver += 1; return true }
    updater.check()
    expectEqual(build.builds, [["/Users/test/Applications", "--no-launch"]], "the build never stops this copy itself")
    expectEqual(handedOver, 1, "the app opens the new copy once it is installed")
    expectEqual(notices().map(\.title), ["Updating the Public Desk controller"])
}

test("if the new copy cannot be opened, the controller keeps running and reports it") {
    let build = FakeBuild()
    let (updater, notices) = makeUpdater(build)
    updater.onInstalled = { false }
    updater.check()
    expectEqual(updater.status, .failed("The new controller was installed but did not open."))
    expectEqual(notices().last?.title, "The Public Desk controller could not update")
    updater.check()
    expectEqual(build.builds.count, 1, "not retried in a loop")
}

test("no update runs while Public Desk is starting or stopping") {
    let build = FakeBuild()
    let (updater, _) = makeUpdater(build, busy: true)
    updater.check()
    expectEqual(build.calls, [])
}

test("a failed update is reported once and not retried until the source changes or the user retries") {
    let build = FakeBuild()
    build.build = CommandResult(exitCode: 1, output: "Building Public Desk.app…\nerror: expected '}' in App.swift\n")
    let (updater, notices) = makeUpdater(build)
    updater.check()
    expectEqual(updater.status, .failed("error: expected '}' in App.swift"))
    expectEqual(notices().last, Notice(title: "The Public Desk controller could not update", body: "error: expected '}' in App.swift"))
    updater.check()
    updater.check()
    expectEqual(build.builds.count, 1)

    updater.check(force: true)
    expectEqual(build.builds.count, 2, "Retry Controller Update rebuilds")

    build.hash = String(repeating: "c", count: 64)
    build.build = ok("Installed")
    var handedOver = false
    updater.onInstalled = { handedOver = true; return true }
    updater.check()
    expectEqual(build.builds.count, 3, "a further change is tried")
    expect(handedOver, "and installed")
}

test("a source that matches the installed copy again clears a failure") {
    let build = FakeBuild()
    build.build = CommandResult(exitCode: 1, output: "broken")
    let (updater, _) = makeUpdater(build)
    updater.check()
    build.hash = oldHash
    updater.check()
    expectEqual(updater.status, .upToDate)
}

test("unreadable fingerprints never trigger a build") {
    for output in ["", "cat: App.swift: No such file", String(repeating: "Z", count: 64)] {
        let build = FakeBuild()
        build.hash = output
        let (updater, _) = makeUpdater(build)
        updater.check()
        expectEqual(build.builds, [])
    }
}

test("checks do not overlap, and an update in progress is not started twice") {
    let build = FakeBuild()
    let scheduler = DeferredScheduling()
    let (updater, _) = makeUpdater(build, scheduler: scheduler)
    updater.check()
    updater.check()
    expectEqual(scheduler.pending.count, 1)
    scheduler.pending.removeFirst()() // the fingerprint arrives; the build is queued
    expectEqual(updater.status, .updating)
    updater.check(force: true)
    expectEqual(scheduler.pending.count, 1, "no second build")
    scheduler.drain()
    expectEqual(build.builds.count, 1)
}

test("status checks and fingerprint checks are kept out of the log") {
    let root = temporaryFolder()
    defer { try? FileManager.default.removeItem(at: root) }
    let script = root.appendingPathComponent("build.zsh")
    try "print -r -- ran $*".write(to: script, atomically: true, encoding: .utf8)
    let log = root.appendingPathComponent("menu-bar.log")
    let runner = ScriptRunner(script: script, searchPath: "/usr/bin:/bin", logFile: log, quietCommands: ["--source-hash"])
    _ = runner.run(["--source-hash"], timeout: 10)
    expect(!FileManager.default.fileExists(atPath: log.path), "fingerprint checks are not logged")
    _ = runner.run(["/Applications"], timeout: 10)
    expect(((try? String(contentsOf: log, encoding: .utf8)) ?? "").contains("/Applications → exit 0"), "builds are logged")
}

// MARK: Opening the app

test("opening the app starts anything missing and opens Public Desk") {
    let runner = FakeRunner()
    let (controller, _) = makeController(runner)
    controller.refresh()
    controller.requestOpen()
    expectEqual(runner.actionCalls, [["start", "--open"]])
}

test("opening the app when everything is ready only brings Public Desk forward") {
    let runner = FakeRunner()
    runner.status = allReady
    let (controller, _) = makeController(runner)
    controller.refresh()
    controller.requestOpen()
    expectEqual(runner.actionCalls, [["open"]])
}

test("opening the app during a start opens Public Desk once the start finishes") {
    let runner = FakeRunner()
    let scheduler = DeferredScheduling()
    let (controller, _) = makeController(runner, scheduler: scheduler)
    expect(controller.perform(.start))
    controller.requestOpen()
    controller.requestOpen()
    expectEqual(scheduler.pending.count, 1, "nothing runs beside the start")
    runner.status = allReady
    scheduler.drain()
    expectEqual(runner.actionCalls, [["start"], ["open"]], "opened once, after the start")
}

test("opening the app while a Finder launcher is starting Public Desk waits for it") {
    let runner = FakeRunner()
    runner.status = statusJSON(["ready", "starting", "stopped", "stopped", "stopped"], action: "start")
    let (controller, _) = makeController(runner)
    controller.refresh()
    controller.requestOpen()
    expectEqual(runner.actionCalls, [], "waits while the other launcher works")
    runner.status = allReady
    controller.refresh()
    expectEqual(runner.actionCalls, [["open"]])
    controller.refresh()
    expectEqual(runner.actionCalls, [["open"]], "and only once")
}

test("a launch opens Public Desk except at login or when reopened quietly") {
    expect(LaunchIntent.opensPublicDesk(arguments: ["/Applications/Public Desk.app/Contents/MacOS/Public Desk"],
                                        launchedAsLoginItem: false, secondsSinceLogin: 3600), "opened from Finder")
    expect(LaunchIntent.opensPublicDesk(arguments: ["app"], launchedAsLoginItem: false, secondsSinceLogin: nil),
           "login time unknown")
    expect(!LaunchIntent.opensPublicDesk(arguments: ["app"], launchedAsLoginItem: true, secondsSinceLogin: 3600),
           "macOS says it is a login item")
    expect(!LaunchIntent.opensPublicDesk(arguments: ["app"], launchedAsLoginItem: false, secondsSinceLogin: 20),
           "opened just after logging in")
    expect(LaunchIntent.opensPublicDesk(arguments: ["app"], launchedAsLoginItem: false, secondsSinceLogin: 120),
           "opened by hand two minutes after logging in")
    expect(!LaunchIntent.opensPublicDesk(arguments: ["app", "--background"], launchedAsLoginItem: false,
                                         secondsSinceLogin: 3600), "reopened after an update or install")
    expect(LaunchIntent.opensPublicDesk(arguments: ["app"], launchedAsLoginItem: false, secondsSinceLogin: -5),
           "a clock change never hides a click")
}

print(failures == 0 ? "ok - \(checks) checks passed" : "\(failures) of \(checks) checks failed")
exit(failures == 0 ? 0 : 1)
