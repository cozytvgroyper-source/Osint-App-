// The menu-bar controller's logic, kept free of AppKit so it can be tested with a fake command runner.
// Every service action goes through scripts/public-desk-control.zsh: this file decides only which command to run,
// what colour the menu-bar icon shows, which menu items are enabled and when to notify.

import Foundation

// MARK: - Status from the control script

struct ServiceStatus: Decodable, Equatable {
    let id: String
    let name: String
    let state: String // ready | starting | stopped
}

/// One line of `public-desk-control.zsh status --json`.
struct StatusSnapshot: Decodable, Equatable {
    let overall: String // ready | partial | stopped
    let ready: Int
    let action: String // start | stop | restart while another launcher holds the control lock, else ""
    let services: [ServiceStatus]

    static func parse(_ output: String) -> StatusSnapshot? {
        // Only the last line is JSON; anything before it would be a warning from the script.
        guard let line = output.split(whereSeparator: \.isNewline).last,
              let data = line.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(StatusSnapshot.self, from: data)
    }
}

// MARK: - Commands

enum Action: String, Equatable {
    case open, start, stop, restart

    var progressTitle: String {
        switch self {
        case .open, .start: return "Starting…"
        case .stop: return "Stopping…"
        case .restart: return "Restarting…"
        }
    }
}

struct CommandResult: Equatable {
    let exitCode: Int32
    let output: String

    var succeeded: Bool { exitCode == 0 }

    /// The script's last message, which on failure says what went wrong ("Omega tools did not become ready.").
    var lastLine: String {
        output.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
            .last(where: { !$0.isEmpty }) ?? ""
    }
}

protocol CommandRunning {
    func run(_ arguments: [String], timeout: TimeInterval) -> CommandResult
}

/// Runs the control script with zsh. Output goes to a file rather than a pipe so a script that outlives the
/// controller (Quit during a start) never dies writing to a closed pipe.
final class ScriptRunner: CommandRunning {
    let script: URL
    let searchPath: String
    let logFile: URL?
    /// Frequent read-only commands that are not written to the log.
    let quietCommands: Set<String>

    init(script: URL, searchPath: String, logFile: URL?, quietCommands: Set<String> = ["status"]) {
        self.script = script
        self.searchPath = searchPath
        self.logFile = logFile
        self.quietCommands = quietCommands
    }

    func run(_ arguments: [String], timeout: TimeInterval) -> CommandResult {
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("public-desk-\(UUID().uuidString).log")
        guard FileManager.default.createFile(atPath: outputURL.path, contents: nil, attributes: [.posixPermissions: 0o600]),
              let output = try? FileHandle(forWritingTo: outputURL) else {
            return CommandResult(exitCode: 126, output: "Could not create a temporary file for the control script.")
        }
        defer { try? FileManager.default.removeItem(at: outputURL) }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [script.path] + arguments
        process.currentDirectoryURL = script.deletingLastPathComponent().deletingLastPathComponent()
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = searchPath
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = output
        process.standardError = output

        let finished = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in finished.signal() }
        do { try process.run() } catch {
            try? output.close()
            return CommandResult(exitCode: 127, output: "Could not run the control script: \(error.localizedDescription)")
        }
        var timedOut = false
        if finished.wait(timeout: .now() + timeout) == .timedOut {
            timedOut = true
            process.terminate() // SIGTERM: the script's trap releases the control lock
            _ = finished.wait(timeout: .now() + 5)
        }
        try? output.close()
        var text = (try? String(contentsOf: outputURL, encoding: .utf8)) ?? ""
        if timedOut { text += "\nThe control script did not finish within \(Int(timeout)) seconds." }
        let code: Int32 = timedOut ? 124 : process.terminationStatus
        if !quietCommands.contains(arguments.first ?? "") { appendToLog(arguments: arguments, code: code, text: text) }
        return CommandResult(exitCode: code, output: text)
    }

    private func appendToLog(arguments: [String], code: Int32, text: String) {
        guard let logFile else { return }
        let stamp = ISO8601DateFormatter().string(from: Date())
        let entry = "[\(stamp)] \(arguments.joined(separator: " ")) → exit \(code)\n\(text)\n"
        if !FileManager.default.fileExists(atPath: logFile.path) {
            FileManager.default.createFile(atPath: logFile.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        guard let handle = try? FileHandle(forWritingTo: logFile) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: Data(entry.utf8))
    }
}

// MARK: - Display state

enum Health: String, Equatable {
    case green, yellow, red
}

struct Notice: Equatable {
    let title: String
    let body: String
}

enum MenuCommand: String, CaseIterable {
    case open = "Open Public Desk"
    case start = "Start"
    case stop = "Stop"
    case restart = "Restart"
    case status = "Status"
    case diagnostics = "Diagnostics"
    case quit = "Quit Controller"
}

/// Everything the menu shows, derived from the latest status and the action in progress. Pure state: the
/// Controller feeds it events and acts on the notices it returns.
struct ControllerState: Equatable {
    private(set) var snapshot: StatusSnapshot?
    private(set) var runningAction: Action?
    private(set) var failure: String?
    private(set) var statusError: String?

    // MARK: Events

    /// Returns false when an action is already running, so a second click never starts a duplicate.
    mutating func begin(_ action: Action) -> Bool {
        guard runningAction == nil, snapshot?.action.isEmpty ?? true else { return false }
        runningAction = action
        failure = nil
        return true
    }

    mutating func finish(_ action: Action, _ result: CommandResult) -> [Notice] {
        runningAction = nil
        if result.succeeded {
            switch action {
            case .open, .start, .restart:
                return [Notice(title: "Public Desk is ready", body: "All five services are running.")]
            case .stop:
                return []
            }
        }
        let reason = result.lastLine.isEmpty ? "The control script exited with code \(result.exitCode)." : result.lastLine
        switch action {
        case .open, .start, .restart:
            failure = "Start failed"
            return [Notice(title: "Public Desk could not start", body: reason)]
        case .stop:
            failure = "Stop failed"
            return [Notice(title: "Public Desk could not stop", body: reason)]
        }
    }

    /// Applies a status poll. A service that was ready and is now unavailable, while nothing was starting or
    /// stopping it, is reported once and turns the icon red until it recovers or the user acts.
    mutating func apply(status result: CommandResult) -> [Notice] {
        guard let next = StatusSnapshot.parse(result.output) else {
            statusError = result.lastLine.isEmpty ? "Status is unavailable." : result.lastLine
            return []
        }
        statusError = nil
        let previous = snapshot
        snapshot = next
        if next.overall == "ready" || next.overall == "stopped" { failure = nil }

        guard runningAction == nil, next.action.isEmpty, let previous, previous.action.isEmpty,
              next.overall != "stopped" else { return [] }
        let wasReady = Set(previous.services.filter { $0.state == "ready" }.map(\.id))
        let lost = next.services.filter { wasReady.contains($0.id) && $0.state != "ready" }
        guard !lost.isEmpty else { return [] }
        let names = lost.map(\.name)
        failure = names.count == 1 ? "\(names[0]) is unavailable" : "\(names.count) services are unavailable"
        let subject = names.count == 1 ? "\(names[0]) stopped" : "\(names.count) Public Desk services stopped"
        return [Notice(title: subject, body: "Choose Start to bring \(names.count == 1 ? "it" : "them") back.")]
    }

    // MARK: Derived

    var health: Health {
        if isBusy { return .yellow }
        if failure != nil || statusError != nil { return .red }
        switch snapshot?.overall {
        case "ready": return .green
        case "stopped": return .red
        case nil: return .yellow
        default: return .yellow
        }
    }

    var headline: String {
        if let runningAction { return runningAction.progressTitle }
        if let action = snapshot?.action, !action.isEmpty {
            return Action(rawValue: action)?.progressTitle ?? "Busy…"
        }
        if let failure { return failure }
        if let statusError { return statusError }
        guard let snapshot else { return "Checking…" }
        switch snapshot.overall {
        case "ready": return "Ready"
        case "stopped": return "Stopped"
        default: return "Partially available (\(snapshot.ready) of \(snapshot.services.count) ready)"
        }
    }

    /// A start, stop or restart is running, begun by this controller or by a Finder launcher.
    var isBusy: Bool { runningAction != nil || !(snapshot?.action.isEmpty ?? true) }

    /// Whether a menu item can be chosen now. Lifecycle actions are disabled while any start or stop is running,
    /// whether this controller or a Finder launcher began it.
    func isEnabled(_ command: MenuCommand) -> Bool {
        switch command {
        case .open, .start, .restart: return !isBusy
        case .stop: return !isBusy && snapshot?.overall != "stopped"
        case .status, .diagnostics, .quit: return true
        }
    }

    /// The control-script arguments for an action; Open starts any missing services first.
    func arguments(for action: Action) -> [String] {
        switch action {
        case .open: return snapshot?.overall == "ready" ? ["open"] : ["start", "--open"]
        case .start: return ["start"]
        case .stop: return ["stop"]
        case .restart: return ["restart"]
        }
    }

    func serviceLines() -> [String] {
        guard let snapshot else { return ["Status not checked yet"] }
        return snapshot.services.map { service in
            let label: String
            switch service.state {
            case "ready": label = "Ready"
            case "starting": label = "Starting or not responding"
            default: label = "Stopped"
            }
            return "\(service.name): \(label)"
        }
    }
}

// MARK: - Controller

/// Where work runs. The app uses a background queue and the main thread; tests run everything immediately.
protocol Scheduling {
    func background(_ work: @escaping () -> Void)
    func main(_ work: @escaping () -> Void)
}

struct DispatchScheduling: Scheduling {
    func background(_ work: @escaping () -> Void) { DispatchQueue.global(qos: .userInitiated).async(execute: work) }
    func main(_ work: @escaping () -> Void) { DispatchQueue.main.async(execute: work) }
}

final class Controller {
    static let statusTimeout: TimeInterval = 30
    static let actionTimeout: TimeInterval = 600

    private(set) var state = ControllerState()
    private var refreshing = false
    private var openWhenIdle = false
    private let runner: CommandRunning
    private let scheduler: Scheduling
    var onChange: () -> Void = {}
    var onNotice: (Notice) -> Void = { _ in }
    var onText: (String, String) -> Void = { _, _ in }

    init(runner: CommandRunning, scheduler: Scheduling) {
        self.runner = runner
        self.scheduler = scheduler
    }

    /// Reads status without changing anything. Overlapping polls are skipped, so a slow check never stacks up.
    func refresh() {
        guard !refreshing else { return }
        refreshing = true
        scheduler.background { [runner] in
            let result = runner.run(["status", "--json"], timeout: Controller.statusTimeout)
            self.scheduler.main {
                self.refreshing = false
                let notices = self.state.apply(status: result)
                notices.forEach(self.onNotice)
                self.onChange()
                self.openIfRequested()
            }
        }
    }

    /// Opening the app's icon opens Public Desk, like Open Public Desk in the menu: it starts anything missing, then
    /// opens or brings forward the browser tab. If a start or stop is running (from here or a Finder launcher), it
    /// opens once that finishes, so the click is never lost and never runs beside it. Repeated requests open once.
    func requestOpen() {
        openWhenIdle = true
        openIfRequested()
    }

    private func openIfRequested() {
        guard openWhenIdle, !state.isBusy else { return }
        openWhenIdle = false
        perform(.open)
    }

    @discardableResult
    func perform(_ action: Action) -> Bool {
        let arguments = state.arguments(for: action)
        guard state.begin(action) else { return false }
        onChange()
        scheduler.background { [runner] in
            let result = runner.run(arguments, timeout: Controller.actionTimeout)
            self.scheduler.main {
                let notices = self.state.finish(action, result)
                notices.forEach(self.onNotice)
                self.onChange()
                self.refresh()
            }
        }
        return true
    }

    func choose(_ command: MenuCommand) {
        guard state.isEnabled(command) else { return }
        switch command {
        case .open: perform(.open)
        case .start: perform(.start)
        case .stop: perform(.stop)
        case .restart: perform(.restart)
        case .status: runForText(["status"], title: "Public Desk status")
        case .diagnostics: runForText(["diagnostics", "--open"], title: "Public Desk diagnostics")
        case .quit: break // the app quits itself; services keep running
        }
    }

    private func runForText(_ arguments: [String], title: String) {
        scheduler.background { [runner] in
            let result = runner.run(arguments, timeout: Controller.statusTimeout)
            self.scheduler.main { self.onText(title, result.output.trimmingCharacters(in: .whitespacesAndNewlines)) }
        }
        refresh()
    }
}

// MARK: - Launch

/// Whether opening the app should open Public Desk. Opening it from Finder, Spotlight or the Dock should. Starting at
/// login should not (a browser tab at every login), nor should the controller reopening itself after an update or
/// install, which passes `quietFlag`.
enum LaunchIntent {
    static let quietFlag = "--background"
    /// How soon after logging in a launch still counts as Start at Login, when macOS does not say so itself.
    static let loginWindow: TimeInterval = 90

    static func opensPublicDesk(arguments: [String], launchedAsLoginItem: Bool, secondsSinceLogin: TimeInterval?) -> Bool {
        if arguments.contains(quietFlag) || launchedAsLoginItem { return false }
        if let secondsSinceLogin, secondsSinceLogin >= 0, secondsSinceLogin < loginWindow { return false }
        return true
    }
}

// MARK: - Self-update

enum UpdateStatus: Equatable {
    case upToDate
    case updating
    case failed(String)
}

/// Keeps the installed app in step with this checkout. The build script prints a fingerprint of the app's source;
/// when it differs from the one this copy was built from, the controller rebuilds and reinstalls itself, then opens
/// the new copy and quits. The build never stops this copy itself: macOS would end the build with it. Services are
/// never touched. A failed build is not retried until
/// the source changes again (or the user asks), so a half-edited file never causes a rebuild loop.
final class SelfUpdater {
    static let hashTimeout: TimeInterval = 30
    static let buildTimeout: TimeInterval = 600

    private(set) var status = UpdateStatus.upToDate
    private var checking = false
    private var failedHash: String?
    private let runner: CommandRunning
    private let scheduler: Scheduling
    private let installedHash: String
    private let destination: String
    private let isBusy: () -> Bool
    var onChange: () -> Void = {}
    var onNotice: (Notice) -> Void = { _ in }
    /// Called once the new copy is installed; the app then opens it and quits. Returns false if that failed.
    var onInstalled: () -> Bool = { false }

    /// `runner` runs scripts/build-menu-bar-app.zsh; `destination` is the folder this app is installed in.
    init(runner: CommandRunning, scheduler: Scheduling, installedHash: String, destination: String,
         isBusy: @escaping () -> Bool) {
        self.runner = runner
        self.scheduler = scheduler
        self.installedHash = installedHash
        self.destination = destination
        self.isBusy = isBusy
    }

    static func isFingerprint(_ text: String) -> Bool {
        text.count == 64 && text.allSatisfy { $0.isHexDigit && !$0.isUppercase }
    }

    /// Never runs while Public Desk is starting or stopping; the next check picks the update up.
    func check(force: Bool = false) {
        guard !checking, status != .updating, !isBusy() else { return }
        checking = true
        scheduler.background { [runner] in
            let result = runner.run(["--source-hash"], timeout: SelfUpdater.hashTimeout)
            self.scheduler.main { self.decide(result, force: force) }
        }
    }

    private func decide(_ result: CommandResult, force: Bool) {
        let current = result.lastLine
        guard result.succeeded, SelfUpdater.isFingerprint(current) else {
            checking = false
            return // the folder is unreadable or mid-change; try again later
        }
        if current == installedHash {
            checking = false
            if status != .upToDate { status = .upToDate; onChange() }
            return
        }
        if current == failedHash && !force {
            checking = false
            return
        }
        guard !isBusy() else { checking = false; return }
        status = .updating
        onChange()
        onNotice(Notice(title: "Updating the Public Desk controller",
                        body: "It will reopen in a moment. Public Desk's services keep running."))
        scheduler.background { [runner, destination] in
            let build = runner.run([destination, "--no-launch"], timeout: SelfUpdater.buildTimeout)
            self.scheduler.main {
                self.checking = false
                if build.succeeded && self.onInstalled() {
                    return // this copy is quitting
                }
                if build.succeeded {
                    self.failedHash = current
                    self.status = .failed("The new controller was installed but did not open.")
                    self.onNotice(Notice(title: "The Public Desk controller could not update",
                                         body: "The new copy was installed but did not open. Quit and reopen Public Desk."))
                } else {
                    self.failedHash = current
                    let reason = build.lastLine.isEmpty ? "The build exited with code \(build.exitCode)." : build.lastLine
                    self.status = .failed(reason)
                    self.onNotice(Notice(title: "The Public Desk controller could not update", body: reason))
                }
                self.onChange()
            }
        }
    }
}

// MARK: - Single instance

/// An exclusive lock on a file. The kernel drops a flock when its process exits, even after a crash or kill -9,
/// so a lock can never be left behind: a stale lock file is simply locked again by the next controller.
final class InstanceLock {
    let path: String
    private var descriptor: Int32 = -1

    init(path: String) { self.path = path }

    deinit { release() }

    var isHeld: Bool { descriptor >= 0 }

    func acquire() -> Bool {
        if isHeld { return true }
        let folder = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        let fd = open(path, O_RDWR | O_CREAT | O_CLOEXEC, 0o600)
        guard fd >= 0 else { return false }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
            close(fd)
            return false
        }
        ftruncate(fd, 0)
        let pid = "\(getpid())\n"
        _ = pid.withCString { write(fd, $0, strlen($0)) }
        descriptor = fd
        return true
    }

    func release() {
        guard descriptor >= 0 else { return }
        flock(descriptor, LOCK_UN)
        close(descriptor)
        descriptor = -1
    }
}
