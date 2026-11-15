// Public Desk in its own window: the same interface the browser shows, in a native window with a Dock icon and the
// usual Mac menus while it is open. Closing the window (or ⌘Q) stops Public Desk; the menu-bar icon stays.
// Which links stay in the window, and when to ask before closing, are decided in Core.swift (LinkPolicy, WindowClose).

import AppKit
import WebKit

final class PublicDeskWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let tokenFile: URL
    private var window: NSWindow?
    private var webView: WKWebView?
    private var loadedToken = ""
    private var closingForStop = false
    /// The user closed the window (or chose Quit): Public Desk should stop.
    var onCloseRequested: () -> Void = {}

    init(root: URL) {
        tokenFile = root.appendingPathComponent("work/runtime/public-desk-token")
        super.init()
    }

    var isOpen: Bool { window != nil }

    /// The per-launch access token, read from the owner-only file the control script writes. It reaches the page in
    /// the address fragment, which never leaves this Mac and which the page moves into session storage at once.
    private func currentToken() -> String? {
        guard let text = try? String(contentsOf: tokenFile, encoding: .utf8) else { return nil }
        let token = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return token.isEmpty ? nil : token
    }

    private func load(_ token: String) {
        guard let url = URL(string: "http://127.0.0.1:4173/#access=\(token)") else { return }
        loadedToken = token
        webView?.load(URLRequest(url: url))
    }

    func show() {
        guard let token = currentToken() else { return }
        if window == nil { build() }
        if token != loadedToken { load(token) }
        NSApp.setActivationPolicy(.regular)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// A restart (from anywhere: the menu, Terminal, a Finder launcher) creates a new token; the page reloads with it.
    func reloadIfTokenChanged() {
        guard isOpen, let token = currentToken(), token != loadedToken else { return }
        load(token)
    }

    /// Public Desk has stopped: the window goes too.
    func close() {
        guard let window else { return }
        closingForStop = true
        window.close()
    }

    func goHome() {
        if let token = currentToken() { load(token) }
    }

    func printPage() {
        guard let webView, let window else { return }
        let operation = webView.printOperation(with: NSPrintInfo.shared)
        operation.view?.frame = webView.bounds
        operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    /// Closing the window, ⌘W or Quit: ask first if a Deep Search is running, then stop Public Desk.
    func requestClose() {
        guard let window else { return }
        window.performClose(nil)
    }

    private func build() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // keeps the page's saved settings, as the browser did
        configuration.applicationNameForUserAgent = "PublicDesk"
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        if #available(macOS 13.3, *) { webView.isInspectable = true }

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Public Desk"
        window.minSize = NSSize(width: 760, height: 520)
        window.contentView = webView
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("PublicDeskWindow")
        self.window = window
        self.webView = webView
    }

    // MARK: Closing

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closingForStop { return true }
        guard let webView else { return true }
        webView.evaluateJavaScript("document.documentElement.dataset.busy || ''") { [weak self] value, _ in
            guard let self else { return }
            if let message = WindowClose.confirmation(busyMarker: value as? String ?? "") {
                let alert = NSAlert()
                alert.messageText = "Stop Public Desk?"
                alert.informativeText = message
                alert.addButton(withTitle: "Stop Public Desk")
                alert.addButton(withTitle: "Cancel")
                alert.beginSheetModal(for: sender) { response in
                    if response == .alertFirstButtonReturn { self.closeAndStop() }
                }
            } else {
                self.closeAndStop()
            }
        }
        return false
    }

    private func closeAndStop() {
        onCloseRequested()
        close()
    }

    func windowWillClose(_ notification: Notification) {
        // The page is discarded with the window: Public Desk is stopping, and a new window loads afresh.
        webView?.stopLoading()
        window?.delegate = nil
        window = nil
        webView = nil
        loadedToken = ""
        closingForStop = false
        NSApp.setActivationPolicy(.accessory)
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download, preferences) }
        let newWindow = action.targetFrame == nil
        switch LinkPolicy.decide(action.request.url, newWindow: newWindow) {
        case .inWindow:
            decisionHandler(.allow, preferences)
        case .external:
            if let url = action.request.url { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel, preferences)
        case .block:
            decisionHandler(.cancel, preferences)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// A page or window.open asking for a new window ("↗" links, sign-up pages) opens in the default browser.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if LinkPolicy.decide(action.request.url, newWindow: true) == .external, let url = action.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    /// A load of Public Desk itself that fails (the server was not up yet) is tried again on the next status check.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView.url == nil || webView.url?.host == "127.0.0.1" { loadedToken = "" }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        goHome()
    }

    // MARK: Downloads (reports, case exports)

    /// Saved through the standard Save panel, opening at Downloads: files chosen there need no extra permission,
    /// so macOS never asks for access to Downloads after an update.
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.canCreateDirectories = true
        guard let window else { return completionHandler(nil) }
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { return completionHandler(nil) }
            try? FileManager.default.removeItem(at: url) // the panel already asked before replacing
            completionHandler(url)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let alert = NSAlert()
        alert.messageText = "The download did not finish"
        alert.informativeText = error.localizedDescription
        if let window { alert.beginSheetModal(for: window) } else { alert.runModal() }
    }

    // MARK: File uploads and the page's own dialogs

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        guard let window else { return completionHandler(nil) }
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        present(alert) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        present(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    /// The page asks for text this way when naming or renaming a case.
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        present(alert) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    private func present(_ alert: NSAlert, then: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window { alert.beginSheetModal(for: window, completionHandler: then) } else { then(alert.runModal()) }
    }
}
