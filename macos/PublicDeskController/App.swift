// The Public Desk menu-bar controller: a status icon and menu over scripts/public-desk-control.zsh.
// The logic lives in Core.swift; this file only draws the menu, schedules status checks and shows notices.

import AppKit
import ServiceManagement
import UserNotifications

// Sent by a second copy of the app to the running one: open Public Desk, as clicking the app's icon should.
let openPublicDeskNotification = Notification.Name("local.public-desk.controller.open-public-desk")

@main
enum PublicDeskControllerMain {
    static func main() {
        // One controller per user. A second launch asks the first to open Public Desk, then exits; a quiet second
        // launch (an update or install reopening the app) just exits.
        let lockPath = ProcessInfo.processInfo.environment["PUBLIC_DESK_CONTROLLER_LOCK"]
            ?? (NSHomeDirectory() as NSString).appendingPathComponent("Library/Application Support/Public Desk/menu-bar.lock")
        let lock = InstanceLock(path: lockPath)
        guard lock.acquire() else {
            if !CommandLine.arguments.contains(LaunchIntent.quietFlag) {
                DistributedNotificationCenter.default().postNotificationName(openPublicDeskNotification, object: nil,
                                                                             userInfo: nil, deliverImmediately: true)
                print("Public Desk's menu-bar controller is already running; opening Public Desk.")
            }
            exit(0)
        }
        let app = NSApplication.shared
        let delegate = AppDelegate(lock: lock)
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
    private let lock: InstanceLock
    private var controller: Controller?
    private var setupProblem: String?
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    private let menu = NSMenu()
    private var timer: Timer?
    private var lastRefresh = Date.distantPast
    private var updater: SelfUpdater?
    private var lastUpdateCheck = Date.distantPast

    init(lock: InstanceLock) {
        self.lock = lock
        super.init()
    }

    /// Read while macOS is still delivering the launch: it says whether the app was opened as a login item.
    private var launchedAsLoginItem = false
    func applicationWillFinishLaunching(_ notification: Notification) {
        let event = NSAppleEventManager.shared().currentAppleEvent
        launchedAsLoginItem = event?.eventID == kAEOpenApplication
            && event?.paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
    }

    /// Seconds since this user logged in: logging in hands the console device to the user, which stamps its
    /// change time. A backup for login items that macOS does not mark as such.
    private func secondsSinceLogin() -> TimeInterval? {
        var info = stat()
        guard stat("/dev/console", &info) == 0, info.st_uid == getuid() else { return nil }
        let changed = TimeInterval(info.st_ctimespec.tv_sec) + TimeInterval(info.st_ctimespec.tv_nsec) / 1e9
        return Date().timeIntervalSince1970 - changed
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        menu.delegate = self
        menu.autoenablesItems = false
        statusItem.menu = menu

        if let runner = makeRunner() {
            let controller = Controller(runner: runner, scheduler: DispatchScheduling())
            controller.onChange = { [weak self] in self?.render() }
            controller.onNotice = { [weak self] notice in self?.post(notice) }
            controller.onText = { [weak self] title, text in self?.showText(title, text) }
            self.controller = controller
            controller.refresh()
            // Opening the app opens Public Desk; this comes before the update check so an update waits for it.
            if LaunchIntent.opensPublicDesk(arguments: CommandLine.arguments, launchedAsLoginItem: launchedAsLoginItem,
                                            secondsSinceLogin: secondsSinceLogin()) {
                controller.requestOpen()
            }
            updater = makeUpdater(controller: controller, controlRunner: runner)
            updater?.check()
            lastUpdateCheck = Date()
        }
        render()

        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }

        DistributedNotificationCenter.default().addObserver(self, selector: #selector(openPublicDesk),
                                                            name: openPublicDeskNotification, object: nil,
                                                            suspensionBehavior: .deliverImmediately)
        // Checks every 10 seconds, or every 2 while something is starting or stopping. Checks only read status.
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
    }

    /// Opening the app again while it runs (Finder, Spotlight, the Dock) opens Public Desk.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        openPublicDesk()
        return false
    }

    /// Without a working setup there is nothing to open, so the menu explains what is wrong instead.
    @objc private func openPublicDesk() {
        if let controller { controller.requestOpen() } else { showMenu() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        lock.release() // Quitting the controller leaves every Public Desk service running.
    }

    // MARK: Setup

    private func makeRunner() -> ScriptRunner? {
        let environment = ProcessInfo.processInfo.environment
        let info = Bundle.main.infoDictionary ?? [:]
        guard let root = environment["PUBLIC_DESK_ROOT"] ?? info["PublicDeskRoot"] as? String else {
            setupProblem = "Public Desk folder not set. Rebuild with npm run menu-bar."
            return nil
        }
        let script = URL(fileURLWithPath: root).appendingPathComponent("scripts/public-desk-control.zsh")
        guard FileManager.default.fileExists(atPath: script.path) else {
            setupProblem = "Public Desk folder not found. Rebuild with npm run menu-bar."
            return nil
        }
        // Apps opened from Finder get a minimal PATH; node and uv usually live elsewhere.
        let home = NSHomeDirectory()
        let built = info["PublicDeskPath"] as? String ?? ""
        let searchPath = [built, "\(home)/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
                          "/usr/sbin", "/sbin"].filter { !$0.isEmpty }.joined(separator: ":")
        let log = URL(fileURLWithPath: root).appendingPathComponent("work/logs/menu-bar.log")
        return ScriptRunner(script: script, searchPath: searchPath, logFile: log)
    }

    /// Only an installed app built by scripts/build-menu-bar-app.zsh knows its source fingerprint and can update.
    private func makeUpdater(controller: Controller, controlRunner: ScriptRunner) -> SelfUpdater? {
        guard let installed = Bundle.main.infoDictionary?["PublicDeskSourceHash"] as? String else { return nil }
        let root = controlRunner.script.deletingLastPathComponent().deletingLastPathComponent()
        let build = root.appendingPathComponent("scripts/build-menu-bar-app.zsh")
        guard FileManager.default.fileExists(atPath: build.path) else { return nil }
        let runner = ScriptRunner(script: build, searchPath: controlRunner.searchPath, logFile: controlRunner.logFile,
                                  quietCommands: ["--source-hash"])
        let updater = SelfUpdater(runner: runner, scheduler: DispatchScheduling(), installedHash: installed,
                                  destination: Bundle.main.bundleURL.deletingLastPathComponent().path,
                                  isBusy: { [weak controller] in controller?.state.isBusy ?? true })
        updater.onChange = { [weak self] in self?.render() }
        updater.onNotice = { [weak self] notice in self?.post(notice) }
        updater.onInstalled = { [weak self] in self?.relaunch() ?? false }
        return updater
    }

    private func tick() {
        // Looks for a newer controller in this folder (after a git pull, say) every 15 minutes.
        if let updater, Date().timeIntervalSince(lastUpdateCheck) >= 15 * 60 {
            lastUpdateCheck = Date()
            updater.check()
        }
        guard let controller else { return }
        let interval: TimeInterval = controller.state.isBusy ? 2 : 10
        guard Date().timeIntervalSince(lastRefresh) >= interval else { return }
        lastRefresh = Date()
        controller.refresh()
    }

    // MARK: Menu

    @objc private func showMenu() {
        statusItem.button?.performClick(nil)
    }

    func menuWillOpen(_ menu: NSMenu) {
        lastRefresh = Date()
        controller?.refresh()
    }

    private func render() {
        let health: Health
        let headline: String
        if let controller {
            health = controller.state.health
            headline = controller.state.headline
        } else {
            health = .red
            headline = setupProblem ?? "Not set up"
        }
        drawIcon(health, headline)
        buildMenu(headline: headline)
        recordState("\(health.rawValue) \(headline)")
    }

    /// Writes what the icon shows to work/runtime/menu-bar-state when it changes, for diagnostics and checks.
    private var recordedState = ""
    private func recordState(_ line: String) {
        guard line != recordedState, controller != nil, let file = stateFile else { return }
        recordedState = line
        try? (line + "\n").write(to: file, atomically: true, encoding: .utf8)
    }

    private lazy var stateFile: URL? = {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let root = ProcessInfo.processInfo.environment["PUBLIC_DESK_ROOT"] ?? info["PublicDeskRoot"] as? String
        else { return nil }
        return URL(fileURLWithPath: root).appendingPathComponent("work/runtime/menu-bar-state")
    }()

    private func drawIcon(_ health: Health, _ headline: String) {
        let color: NSColor
        switch health {
        case .green: color = .systemGreen
        case .yellow: color = .systemYellow
        case .red: color = .systemRed
        }
        let configuration = NSImage.SymbolConfiguration(pointSize: 15, weight: .regular)
            .applying(NSImage.SymbolConfiguration(paletteColors: [.white, color]))
        let image = NSImage(systemSymbolName: "magnifyingglass.circle.fill", accessibilityDescription: "Public Desk")?
            .withSymbolConfiguration(configuration)
        image?.isTemplate = false
        statusItem.button?.image = image
        statusItem.button?.toolTip = "Public Desk: \(headline)"
        statusItem.button?.setAccessibilityLabel("Public Desk: \(headline)")
    }

    private func buildMenu(headline: String) {
        menu.removeAllItems()
        let title = NSMenuItem(title: "Public Desk: \(headline)", action: nil, keyEquivalent: "")
        title.isEnabled = false
        menu.addItem(title)
        menu.addItem(.separator())

        guard let controller else {
            menu.addItem(item("Quit Controller", #selector(quit), key: "q"))
            return
        }
        let state = controller.state
        func add(_ command: MenuCommand, key: String = "") {
            let entry = item(command.rawValue, #selector(choose(_:)), key: key)
            entry.representedObject = command.rawValue
            entry.isEnabled = state.isEnabled(command)
            menu.addItem(entry)
        }
        add(.open, key: "o")
        menu.addItem(.separator())
        add(.start)
        add(.stop)
        add(.restart)
        menu.addItem(.separator())

        let status = NSMenuItem(title: MenuCommand.status.rawValue, action: nil, keyEquivalent: "")
        let services = NSMenu()
        for line in state.serviceLines() {
            let entry = NSMenuItem(title: line, action: nil, keyEquivalent: "")
            entry.isEnabled = false
            services.addItem(entry)
        }
        services.addItem(.separator())
        let details = item("Show Full Status…", #selector(choose(_:)), key: "")
        details.representedObject = MenuCommand.status.rawValue
        services.addItem(details)
        status.submenu = services
        menu.addItem(status)
        add(.diagnostics)
        menu.addItem(.separator())

        switch updater?.status {
        case .updating?:
            let updating = NSMenuItem(title: "Updating Controller…", action: nil, keyEquivalent: "")
            updating.isEnabled = false
            menu.addItem(updating)
        case .failed(let reason)?:
            let retry = item("Retry Controller Update", #selector(retryUpdate), key: "")
            retry.toolTip = "The last update failed: \(reason) Details are in work/logs/menu-bar.log."
            menu.addItem(retry)
        default:
            break
        }
        let login = item("Start at Login", #selector(toggleLogin), key: "")
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())
        menu.addItem(item(MenuCommand.quit.rawValue, #selector(quit), key: "q"))
    }

    private func item(_ title: String, _ action: Selector, key: String) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
        entry.target = self
        return entry
    }

    @objc private func choose(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let command = MenuCommand(rawValue: raw) else { return }
        controller?.choose(command)
    }

    /// Hands over to the newly installed copy: release the single-instance lock, open the new copy, then quit.
    /// If it cannot be opened, this copy takes the lock back and keeps running.
    private func relaunch() -> Bool {
        lock.release()
        let open = Process()
        open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        open.arguments = ["-n", Bundle.main.bundleURL.path, "--args", LaunchIntent.quietFlag]
        do { try open.run() } catch { _ = lock.acquire(); return false }
        open.waitUntilExit()
        guard open.terminationStatus == 0 else { _ = lock.acquire(); return false }
        NSApp.terminate(nil)
        return true
    }

    @objc private func retryUpdate() {
        lastUpdateCheck = Date()
        updater?.check(force: true)
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    // MARK: Start at Login

    /// Uses macOS's own login-item registration, which needs no Apple developer account.
    @objc private func toggleLogin() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled { try service.unregister() } else { try service.register() }
        } catch {
            showText("Start at Login", "macOS did not accept the change: \(error.localizedDescription)\n\n" +
                     "You can add Public Desk in System Settings → General → Login Items.")
        }
        if service.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
        render()
    }

    // MARK: Notices

    private func post(_ notice: Notice) {
        let content = UNMutableNotificationContent()
        content.title = notice.title
        content.body = notice.body
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { error in
            if let error { NSLog("Public Desk notification not shown: %@", error.localizedDescription) }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }

    private func showText(_ title: String, _ text: String) {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text.isEmpty ? "No output." : text
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }
}
