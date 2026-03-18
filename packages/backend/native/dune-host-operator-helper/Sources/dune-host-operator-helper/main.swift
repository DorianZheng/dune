import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

enum HelperError: Error {
    case message(String)
}

func fail(_ message: String, code: String = "host_operator_helper_failed") -> Never {
    let payload: [String: Any] = [
        "ok": false,
        "error": message,
        "code": code,
    ]
    writeJson(payload)
    exit(1)
}

func writeJson(_ value: Any) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: []) else {
        let fallback = "{\"ok\":false,\"error\":\"invalid_json_output\",\"code\":\"host_operator_helper_invalid_output\"}"
        FileHandle.standardOutput.write(Data(fallback.utf8))
        return
    }
    FileHandle.standardOutput.write(data)
}

func readInput() -> [String: Any] {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard !data.isEmpty else { fail("missing_input", code: "host_operator_helper_missing_input") }
    do {
        let raw = try JSONSerialization.jsonObject(with: data)
        guard let dict = raw as? [String: Any] else {
            fail("input_must_be_object", code: "host_operator_helper_invalid_input")
        }
        return dict
    } catch {
        fail("invalid_json_input", code: "host_operator_helper_invalid_input")
    }
}

func readCommand(_ payload: [String: Any]) -> (String, [String: Any]) {
    let command = payload["command"] as? String ?? ""
    let input = payload["input"] as? [String: Any] ?? [:]
    return (command, input)
}

func success(result: Any? = nil, artifacts: [[String: Any]] = []) -> Never {
    var payload: [String: Any] = ["ok": true]
    payload["result"] = result ?? NSNull()
    if !artifacts.isEmpty {
        payload["artifacts"] = artifacts
    }
    writeJson(payload)
    exit(0)
}

func stringValue(_ dictionary: [String: Any], _ key: String) -> String? {
    guard let raw = dictionary[key] else { return nil }
    let value = String(describing: raw).trimmingCharacters(in: .whitespacesAndNewlines)
    return value.isEmpty ? nil : value
}

func intValue(_ dictionary: [String: Any], _ key: String) -> Int? {
    if let raw = dictionary[key] as? Int { return raw }
    if let raw = dictionary[key] as? NSNumber { return raw.intValue }
    if let raw = dictionary[key] as? String { return Int(raw) }
    return nil
}

func doubleValue(_ dictionary: [String: Any], _ key: String) -> Double? {
    if let raw = dictionary[key] as? Double { return raw }
    if let raw = dictionary[key] as? NSNumber { return raw.doubleValue }
    if let raw = dictionary[key] as? String { return Double(raw) }
    return nil
}

func pointValue(_ dictionary: [String: Any], _ key: String) -> CGPoint? {
    guard let raw = dictionary[key] as? [String: Any],
          let x = doubleValue(raw, "x"),
          let y = doubleValue(raw, "y") else {
        return nil
    }
    return CGPoint(x: x, y: y)
}

func appRecord(_ app: NSRunningApplication) -> [String: Any]? {
    guard let bundleId = app.bundleIdentifier, !bundleId.isEmpty else { return nil }
    return [
        "bundleId": bundleId,
        "appName": app.localizedName ?? bundleId,
        "pid": Int(app.processIdentifier),
        "active": app.isActive,
    ]
}

func appForBundleId(_ bundleId: String) -> NSRunningApplication? {
    return NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first
}

func activateApp(_ bundleId: String) throws {
    guard let app = appForBundleId(bundleId) else {
        throw HelperError.message("bundle_id_not_running")
    }
    app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
}

func listApps() -> [[String: Any]] {
    let apps = NSWorkspace.shared.runningApplications.compactMap(appRecord)
    return apps.sorted {
        let lhs = ($0["appName"] as? String ?? "", $0["bundleId"] as? String ?? "")
        let rhs = ($1["appName"] as? String ?? "", $1["bundleId"] as? String ?? "")
        return lhs < rhs
    }
}

func screenCaptureGranted() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightScreenCaptureAccess()
    }
    return true
}

func overviewWindows(bundleId: String?) -> [[String: Any]] {
    guard let rawList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return []
    }

    return rawList.compactMap { info in
        guard let pid = info[kCGWindowOwnerPID as String] as? NSNumber else { return nil }
        let ownerApp = NSRunningApplication(processIdentifier: pid.int32Value)
        let ownerBundleId = ownerApp?.bundleIdentifier ?? ""
        if let bundleId, ownerBundleId != bundleId { return nil }

        let ownerName = info[kCGWindowOwnerName as String] as? String ?? ownerBundleId
        let title = info[kCGWindowName as String] as? String ?? ""
        let windowId = (info[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
        let layer = (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
        let boundsRaw = info[kCGWindowBounds as String] as? [String: Any]
        let bounds = boundsRaw.flatMap { raw -> CGRect? in
            guard let x = raw["X"] as? Double,
                  let y = raw["Y"] as? Double,
                  let width = raw["Width"] as? Double,
                  let height = raw["Height"] as? Double else {
                return nil
            }
            return CGRect(x: x, y: y, width: width, height: height)
        }
        return [
            "bundleId": ownerBundleId,
            "appName": ownerName,
            "windowId": windowId,
            "title": title,
            "layer": layer,
            "bounds": bounds.map {
                [
                    "x": $0.origin.x,
                    "y": $0.origin.y,
                    "width": $0.size.width,
                    "height": $0.size.height,
                ]
            } ?? NSNull(),
        ]
    }
}

func unionBounds(for bundleId: String) -> CGRect? {
    let windows = overviewWindows(bundleId: bundleId)
    let rects = windows.compactMap { window -> CGRect? in
        guard let bounds = window["bounds"] as? [String: Any],
              let x = bounds["x"] as? Double,
              let y = bounds["y"] as? Double,
              let width = bounds["width"] as? Double,
              let height = bounds["height"] as? Double else {
            return nil
        }
        return CGRect(x: x, y: y, width: width, height: height)
    }
    guard var union = rects.first else { return nil }
    for rect in rects.dropFirst() {
        union = union.union(rect)
    }
    return union
}

func pngData(for rect: CGRect?) throws -> Data {
    let imageRect = rect ?? .null
    guard let image = CGWindowListCreateImage(imageRect, [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID, [.bestResolution]) else {
        throw HelperError.message("screenshot_capture_failed")
    }
    let rep = NSBitmapImageRep(cgImage: image)
    guard let data = rep.representation(using: .png, properties: [:]) else {
        throw HelperError.message("png_encoding_failed")
    }
    return data
}

func axValueToPoint(_ value: AXValue) -> CGPoint? {
    var point = CGPoint.zero
    guard AXValueGetType(value) == .cgPoint,
          AXValueGetValue(value, .cgPoint, &point) else {
        return nil
    }
    return point
}

func axValueToSize(_ value: AXValue) -> CGSize? {
    var size = CGSize.zero
    guard AXValueGetType(value) == .cgSize,
          AXValueGetValue(value, .cgSize, &size) else {
        return nil
    }
    return size
}

func copyAttribute(_ element: AXUIElement, _ attribute: CFString) -> Any? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute, &value)
    guard result == .success else { return nil }
    return value
}

func copyAXValue(_ element: AXUIElement, _ attribute: CFString) -> AXValue? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute, &value)
    guard result == .success, let value else { return nil }
    return unsafeBitCast(value, to: AXValue.self)
}

func frameForElement(_ element: AXUIElement) -> [String: Any]? {
    guard let positionValue = copyAXValue(element, kAXPositionAttribute as CFString),
          let sizeValue = copyAXValue(element, kAXSizeAttribute as CFString),
          let point = axValueToPoint(positionValue),
          let size = axValueToSize(sizeValue) else {
        return nil
    }
    return [
        "x": point.x,
        "y": point.y,
        "width": size.width,
        "height": size.height,
    ]
}

func serializeAXElement(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 4) -> [String: Any] {
    var node: [String: Any] = [:]
    if let role = copyAttribute(element, kAXRoleAttribute as CFString) as? String {
        node["role"] = role
    }
    if let title = copyAttribute(element, kAXTitleAttribute as CFString) as? String, !title.isEmpty {
        node["title"] = title
    }
    if let description = copyAttribute(element, kAXDescriptionAttribute as CFString) as? String, !description.isEmpty {
        node["description"] = description
    }
    if let value = copyAttribute(element, kAXValueAttribute as CFString) {
        if let string = value as? String, !string.isEmpty {
            node["value"] = string
        } else if let number = value as? NSNumber {
            node["value"] = number
        }
    }
    if let identifier = copyAttribute(element, kAXIdentifierAttribute as CFString) as? String, !identifier.isEmpty {
        node["identifier"] = identifier
    }
    if let frame = frameForElement(element) {
        node["frame"] = frame
    }
    if depth < maxDepth,
       let children = copyAttribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement],
       !children.isEmpty {
        node["children"] = Array(children.prefix(40)).map { serializeAXElement($0, depth: depth + 1, maxDepth: maxDepth) }
    }
    return node
}

func accessibilityTree(bundleId: String) throws -> [String: Any] {
    guard let app = appForBundleId(bundleId) else {
        throw HelperError.message("bundle_id_not_running")
    }
    let element = AXUIElementCreateApplication(app.processIdentifier)
    let tree = serializeAXElement(element)
    return [
        "bundleId": bundleId,
        "appName": app.localizedName ?? bundleId,
        "tree": tree,
    ]
}

func findNodes(_ node: [String: Any], query: String, matches: inout [[String: Any]]) {
    let haystackParts = [
        node["role"] as? String,
        node["title"] as? String,
        node["description"] as? String,
        node["value"] as? String,
        node["identifier"] as? String,
    ].compactMap { $0?.lowercased() }

    if haystackParts.contains(where: { $0.contains(query) }) {
        matches.append(node)
    }
    if let children = node["children"] as? [[String: Any]] {
        for child in children {
            findNodes(child, query: query, matches: &matches)
        }
    }
}

func screenshotArtifact(bundleId: String) throws -> [[String: Any]] {
    let rect = unionBounds(for: bundleId)
    let data = try pngData(for: rect)
    return [[
        "name": "\(bundleId.replacingOccurrences(of: ".", with: "-")).png",
        "contentBase64": data.base64EncodedString(),
    ]]
}

func perceive(_ input: [String: Any]) throws -> (Any, [[String: Any]]) {
    guard let mode = stringValue(input, "mode"),
          let bundleId = stringValue(input, "bundleId") else {
        throw HelperError.message("invalid_perceive_input")
    }

    let accessibility = try accessibilityTree(bundleId: bundleId)
    switch mode {
    case "accessibility":
        return (accessibility, [])
    case "find":
        let query = (stringValue(input, "query") ?? "").lowercased()
        if query.isEmpty { throw HelperError.message("query_required") }
        let root = accessibility["tree"] as? [String: Any] ?? [:]
        var matches: [[String: Any]] = []
        findNodes(root, query: query, matches: &matches)
        return ([
            "bundleId": bundleId,
            "matches": matches,
        ], [])
    case "screenshot":
        let artifacts = try screenshotArtifact(bundleId: bundleId)
        return ([
            "bundleId": bundleId,
            "artifactCount": artifacts.count,
        ], artifacts)
    case "composite":
        let artifacts = try screenshotArtifact(bundleId: bundleId)
        return ([
            "bundleId": bundleId,
            "accessibility": accessibility["tree"] as Any,
            "artifactCount": artifacts.count,
        ], artifacts)
    default:
        throw HelperError.message("unsupported_perceive_mode")
    }
}

func postMouse(type: CGEventType, point: CGPoint, button: CGMouseButton = .left, clickState: Int64 = 1) throws {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else {
        throw HelperError.message("mouse_event_failed")
    }
    event.setIntegerValueField(.mouseEventClickState, value: clickState)
    event.post(tap: .cghidEventTap)
}

func postKeyboardText(_ text: String) throws {
    for scalar in text.utf16 {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) else {
            throw HelperError.message("keyboard_event_failed")
        }
        var value = scalar
        down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
        up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &value)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
}

func postKeyCode(_ keyCode: CGKeyCode) throws {
    guard let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false) else {
        throw HelperError.message("keyboard_event_failed")
    }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func specialKeyCode(_ key: String) -> CGKeyCode? {
    switch key.lowercased() {
    case "enter", "return": return 36
    case "tab": return 48
    case "space": return 49
    case "escape", "esc": return 53
    case "left": return 123
    case "right": return 124
    case "down": return 125
    case "up": return 126
    case "delete", "backspace": return 51
    default: return nil
    }
}

func act(_ input: [String: Any]) throws -> Any {
    guard let action = stringValue(input, "action") else {
        throw HelperError.message("action_required")
    }
    if let bundleId = stringValue(input, "bundleId"), !["launch", "clipboard_read", "clipboard_write"].contains(action) {
        try activateApp(bundleId)
        usleep(150_000)
    }

    switch action {
    case "launch":
        guard let bundleId = stringValue(input, "bundleId") else { throw HelperError.message("bundle_id_required") }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        process.arguments = ["-b", bundleId]
        try process.run()
        process.waitUntilExit()
        return ["ok": process.terminationStatus == 0]
    case "close":
        guard let bundleId = stringValue(input, "bundleId"),
              let app = appForBundleId(bundleId) else { throw HelperError.message("bundle_id_not_running") }
        return ["ok": app.terminate()]
    case "focus":
        guard let bundleId = stringValue(input, "bundleId") else { throw HelperError.message("bundle_id_required") }
        try activateApp(bundleId)
        return ["ok": true]
    case "url":
        guard let urlString = stringValue(input, "url"), let url = URL(string: urlString) else {
            throw HelperError.message("invalid_url")
        }
        return ["ok": NSWorkspace.shared.open(url)]
    case "clipboard_read":
        return ["text": NSPasteboard.general.string(forType: .string) ?? ""]
    case "clipboard_write":
        let text = stringValue(input, "text") ?? ""
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        return ["ok": true]
    case "type":
        try postKeyboardText(stringValue(input, "text") ?? "")
        return ["ok": true]
    case "press":
        let key = stringValue(input, "key") ?? ""
        if let code = specialKeyCode(key) {
            try postKeyCode(code)
        } else {
            try postKeyboardText(key)
        }
        return ["ok": true]
    case "click", "select":
        guard let point = pointValue(input, "point") else { throw HelperError.message("point_required") }
        try postMouse(type: .mouseMoved, point: point)
        try postMouse(type: .leftMouseDown, point: point)
        try postMouse(type: .leftMouseUp, point: point)
        return ["ok": true]
    case "double_click":
        guard let point = pointValue(input, "point") else { throw HelperError.message("point_required") }
        try postMouse(type: .mouseMoved, point: point)
        try postMouse(type: .leftMouseDown, point: point, clickState: 1)
        try postMouse(type: .leftMouseUp, point: point, clickState: 1)
        try postMouse(type: .leftMouseDown, point: point, clickState: 2)
        try postMouse(type: .leftMouseUp, point: point, clickState: 2)
        return ["ok": true]
    case "right_click":
        guard let point = pointValue(input, "point") else { throw HelperError.message("point_required") }
        try postMouse(type: .mouseMoved, point: point, button: .right)
        try postMouse(type: .rightMouseDown, point: point, button: .right)
        try postMouse(type: .rightMouseUp, point: point, button: .right)
        return ["ok": true]
    case "hover":
        guard let point = pointValue(input, "point") else { throw HelperError.message("point_required") }
        try postMouse(type: .mouseMoved, point: point)
        return ["ok": true]
    case "drag":
        guard let from = pointValue(input, "point"),
              let to = pointValue(input, "toPoint") else { throw HelperError.message("point_required") }
        try postMouse(type: .mouseMoved, point: from)
        try postMouse(type: .leftMouseDown, point: from)
        try postMouse(type: .leftMouseDragged, point: to)
        try postMouse(type: .leftMouseUp, point: to)
        return ["ok": true]
    case "scroll":
        guard pointValue(input, "point") != nil else { throw HelperError.message("point_required") }
        let deltaX = Int32(intValue(input, "deltaX") ?? 0)
        let deltaY = Int32(intValue(input, "deltaY") ?? 0)
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: deltaY, wheel2: deltaX, wheel3: 0) else {
            throw HelperError.message("scroll_event_failed")
        }
        event.post(tap: .cghidEventTap)
        return ["ok": true]
    default:
        throw HelperError.message("unsupported_action")
    }
}

func fileAttributes(at url: URL) -> [String: Any] {
    let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
    return [
        "path": url.path,
        "name": url.lastPathComponent,
        "isDirectory": values?.isDirectory ?? false,
        "size": values?.fileSize ?? 0,
        "modifiedAt": values?.contentModificationDate?.timeIntervalSince1970 ?? 0,
    ]
}

func filesystem(_ input: [String: Any]) throws -> Any {
    guard let op = stringValue(input, "op"),
          let path = stringValue(input, "path") else {
        throw HelperError.message("invalid_filesystem_input")
    }
    let url = URL(fileURLWithPath: path)
    let fm = FileManager.default
    switch op {
    case "list":
        let items = try fm.contentsOfDirectory(at: url, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey], options: [.skipsHiddenFiles])
        return ["entries": items.map(fileAttributes)]
    case "read":
        let data = try Data(contentsOf: url)
        if let text = String(data: data, encoding: .utf8) {
            return ["content": text]
        }
        return ["contentBase64": data.base64EncodedString()]
    case "write":
        let content = stringValue(input, "content") ?? ""
        try content.data(using: .utf8)?.write(to: url, options: .atomic)
        return ["ok": true]
    case "delete":
        try fm.removeItem(at: url)
        return ["ok": true]
    case "search":
        let query = (stringValue(input, "query") ?? "").lowercased()
        let enumerator = fm.enumerator(at: url, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey], options: [.skipsHiddenFiles])
        var results: [[String: Any]] = []
        while let next = enumerator?.nextObject() as? URL, results.count < 100 {
            let pathLower = next.path.lowercased()
            if pathLower.contains(query) {
                results.append(["path": next.path, "match": "path"])
                continue
            }
            let values = try? next.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            if values?.isRegularFile == true, (values?.fileSize ?? 0) < 256_000,
               let text = try? String(contentsOf: next, encoding: .utf8),
               text.lowercased().contains(query) {
                results.append(["path": next.path, "match": "content"])
            }
        }
        return ["results": results]
    default:
        throw HelperError.message("unsupported_filesystem_op")
    }
}

let payload = readInput()
let (command, input) = readCommand(payload)

do {
    switch command {
    case "list_apps":
        success(result: listApps())
    case "status":
        success(result: [
            "available": true,
            "platform": "darwin",
            "provider": "darwin-helper",
            "accessibilityGranted": AXIsProcessTrusted(),
            "screenCaptureGranted": screenCaptureGranted(),
        ])
    case "overview":
        success(result: [
            "windows": overviewWindows(bundleId: stringValue(input, "bundleId")),
        ])
    case "perceive":
        let (result, artifacts) = try perceive(input)
        success(result: result, artifacts: artifacts)
    case "act":
        success(result: try act(input))
    case "filesystem":
        success(result: try filesystem(input))
    default:
        fail("unsupported_command", code: "unsupported_command")
    }
} catch let error as HelperError {
    switch error {
    case .message(let message):
        fail(message)
    }
} catch {
    fail(error.localizedDescription)
}
