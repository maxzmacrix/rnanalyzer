import Foundation
import Capacitor
import Network
import PostgresClientKit
import HealthKit
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Capacitor plugin giving the RN Analyzer web app access to an unmodified Race Navigator:
///  - discover():     Bonjour browse for `_racenav._tcp.` → [{name, host, port}]
///  - ftpDownload():  download a file from the device's FTP server into the app's Caches directory (progress events "ftpProgress")
///  - pgQuery():      run a read-only SQL query against the device's PostgreSQL (fallback for measurements)
///  - deleteFile():   remove a downloaded temp file
@objc(RnDevicePlugin)
public class RnDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RnDevicePlugin"
    public let jsName = "RnDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ftpDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pgQuery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cameraStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cameraStop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "healthHeartRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aiAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aiGenerate", returnType: CAPPluginReturnPromise),
    ]

    private var camera: MJPEGSocketStream?

    private var browser: BonjourBrowser?
    private let ftpQueue = DispatchQueue(label: "rn.device.ftp")

    // MARK: - Bonjour

    @objc func discover(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "_racenav._tcp."
        let timeout = (call.getDouble("timeout") ?? 3000) / 1000.0
        DispatchQueue.main.async {
            let b = BonjourBrowser(type: type)
            self.browser = b
            b.start(timeout: timeout) { devices in
                call.resolve(["devices": devices])
                self.browser = nil
            }
        }
    }

    // MARK: - FTP

    @objc func ftpDownload(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), let path = call.getString("path") else {
            call.reject("host and path are required"); return
        }
        let port = UInt16(call.getInt("port") ?? 21)
        let user = call.getString("user") ?? "rtts"
        let password = call.getString("password") ?? "rtts8888"
        let fileName = call.getString("fileName") ?? (path as NSString).lastPathComponent
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("rn-downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(fileName)
        try? FileManager.default.removeItem(at: dest)

        ftpQueue.async {
            let client = FTPClient(host: host, port: port, user: user, password: password)
            var lastReport = Date()
            let start = Date()
            client.download(path: path, to: dest, progress: { loaded, total in
                let now = Date()
                if now.timeIntervalSince(lastReport) > 0.15 {
                    lastReport = now
                    let bps = Double(loaded) / max(0.001, now.timeIntervalSince(start))
                    self.notifyListeners("ftpProgress", data: ["fileName": fileName, "loaded": loaded, "total": total, "bps": bps])
                }
            }, completion: { result in
                switch result {
                case .success(let size):
                    self.notifyListeners("ftpProgress", data: ["fileName": fileName, "loaded": size, "total": size, "bps": 0])
                    call.resolve(["path": dest.path, "size": size, "fileName": fileName])
                case .failure(let err):
                    call.reject("FTP: \(err.localizedDescription)")
                }
            })
        }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        if let p = call.getString("path") { try? FileManager.default.removeItem(atPath: p) }
        call.resolve()
    }

    // MARK: - Camera preview (MJPEG frames over a raw TCP socket, one port per camera)

    @objc func cameraStart(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), let port = call.getInt("port") else { call.reject("host and port are required"); return }
        camera?.stop()
        let stream = MJPEGSocketStream(host: host, port: UInt16(port))
        camera = stream
        var lastEmit = Date(timeIntervalSince1970: 0)
        stream.onFrame = { [weak self] jpeg in
            let now = Date()
            if now.timeIntervalSince(lastEmit) < 0.08 { return } // <= ~12 fps to the WebView
            lastEmit = now
            self?.notifyListeners("cameraFrame", data: ["jpeg": jpeg.base64EncodedString(), "size": jpeg.count])
        }
        stream.onEnd = { [weak self] error in
            self?.notifyListeners("cameraEnd", data: ["error": error ?? ""])
        }
        stream.start()
        call.resolve()
    }

    @objc func cameraStop(_ call: CAPPluginCall) {
        camera?.stop(); camera = nil
        call.resolve()
    }

    // MARK: - Apple Health (heart rate from Apple Watch etc.)

    private lazy var healthStore: HKHealthStore? = HKHealthStore.isHealthDataAvailable() ? HKHealthStore() : nil

    @objc func healthAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    /// healthHeartRate({from: ms, to: ms}) → {samples: [{t: ms, bpm: Double}]} (asks for read permission on first use)
    @objc func healthHeartRate(_ call: CAPPluginCall) {
        guard let store = healthStore, let type = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            call.reject("Health data not available on this device"); return
        }
        let from = call.getDouble("from") ?? 0
        let to = call.getDouble("to") ?? 0
        guard to > from else { call.reject("from/to (ms) required"); return }
        store.requestAuthorization(toShare: nil, read: [type]) { _, err in
            if let err = err { call.reject("HealthKit: \(err.localizedDescription)"); return }
            let start = Date(timeIntervalSince1970: from / 1000), end = Date(timeIntervalSince1970: to / 1000)
            let pred = HKQuery.predicateForSamples(withStart: start, end: end, options: [])
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
            let q = HKSampleQuery(sampleType: type, predicate: pred, limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
                if let error = error { call.reject("HealthKit: \(error.localizedDescription)"); return }
                let unit = HKUnit.count().unitDivided(by: .minute())
                let out: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map { s in
                    ["t": s.startDate.timeIntervalSince1970 * 1000, "bpm": s.quantity.doubleValue(for: unit)]
                }
                call.resolve(["samples": out])
            }
            store.execute(q)
        }
    }

    // MARK: - On-device language model (Apple Foundation Models, iOS 26)

    @objc func aiAvailable(_ call: CAPPluginCall) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            let availability = SystemLanguageModel.default.availability
            if case .available = availability { call.resolve(["available": true, "provider": "apple"]); return }
            call.resolve(["available": false, "provider": "apple", "status": "\(availability)"]); return
        }
        #endif
        call.resolve(["available": false, "provider": "none"])
    }

    /// aiGenerate({prompt, instructions}) → {text}
    @objc func aiGenerate(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt") else { call.reject("prompt required"); return }
        let instructions = call.getString("instructions") ?? ""
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            Task {
                do {
                    let session = LanguageModelSession(instructions: instructions)
                    let response = try await session.respond(to: prompt)
                    call.resolve(["text": response.content])
                } catch {
                    call.reject("AI: \(error.localizedDescription)")
                }
            }
            return
        }
        #endif
        call.reject("On-device model not available")
    }

    // MARK: - PostgreSQL

    @objc func pgQuery(_ call: CAPPluginCall) {
        guard let host = call.getString("host"), let sql = call.getString("sql") else { call.reject("host and sql are required"); return }
        let database = call.getString("database") ?? "rtts"
        let user = call.getString("user") ?? "rtts"
        let password = call.getString("password") ?? "rtts8888"
        let port = call.getInt("port") ?? 5432
        DispatchQueue.global(qos: .userInitiated).async {
            let credentials: [PostgresClientKit.Credential] = [.md5Password(password: password), .scramSHA256(password: password), .cleartextPassword(password: password)]
            var lastError: Error?
            for cred in credentials {
                do {
                    var config = PostgresClientKit.ConnectionConfiguration()
                    config.host = host
                    config.port = port
                    config.database = database
                    config.user = user
                    config.credential = cred
                    config.ssl = false
                    let connection = try PostgresClientKit.Connection(configuration: config)
                    defer { connection.close() }
                    let statement = try connection.prepareStatement(text: sql)
                    defer { statement.close() }
                    let cursor = try statement.execute(retrieveColumnMetadata: true)
                    defer { cursor.close() }
                    let names = (cursor.columns ?? []).map { $0.name }
                    var rows: [[String: Any]] = []
                    for r in cursor {
                        let row = try r.get()
                        var obj: [String: Any] = [:]
                        for (i, col) in row.columns.enumerated() {
                            let key = i < names.count ? names[i] : "c\(i)"
                            if let v = try? col.optionalString() { obj[key] = v ?? NSNull() } else { obj[key] = NSNull() }
                        }
                        rows.append(obj)
                    }
                    call.resolve(["rows": rows, "columns": names])
                    return
                } catch {
                    lastError = error
                    // authentication with this credential type failed → try the next one
                    continue
                }
            }
            call.reject("PostgreSQL: \(lastError?.localizedDescription ?? "unknown error")")
        }
    }
}

// MARK: - Bonjour browser -------------------------------------------------------------------------

final class BonjourBrowser: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let browser = NetServiceBrowser()
    private let type: String
    private var services: [NetService] = []
    private var results: [[String: Any]] = []
    private var done: (([[String: Any]]) -> Void)?

    init(type: String) { self.type = type; super.init(); browser.delegate = self }

    func start(timeout: TimeInterval, completion: @escaping ([[String: Any]]) -> Void) {
        done = completion
        browser.searchForServices(ofType: type, inDomain: "local.")
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.finish() }
    }
    private func finish() {
        browser.stop()
        for s in services { s.stop() }
        let cb = done; done = nil
        cb?(results)
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: 2.5)
    }
    func netServiceDidResolveAddress(_ sender: NetService) {
        var ip: String?
        for data in sender.addresses ?? [] {
            data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                guard let base = raw.baseAddress else { return }
                let sa = base.assumingMemoryBound(to: sockaddr.self)
                if sa.pointee.sa_family == sa_family_t(AF_INET) {
                    var addr = base.assumingMemoryBound(to: sockaddr_in.self).pointee.sin_addr
                    var buf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                    if inet_ntop(AF_INET, &addr, &buf, socklen_t(INET_ADDRSTRLEN)) != nil { ip = String(cString: buf) }
                }
            }
            if ip != nil { break }
        }
        let host = ip ?? (sender.hostName ?? "")
        if !host.isEmpty && !results.contains(where: { ($0["host"] as? String) == host }) {
            results.append(["name": sender.name, "host": host, "hostname": sender.hostName ?? "", "port": sender.port])
        }
    }
    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) { /* ignore */ }
}

// MARK: - Minimal FTP client (passive mode, binary) on Network.framework ---------------------------

final class FTPClient {
    enum FTPError: LocalizedError {
        case protocolError(String), connection(String), io(String)
        var errorDescription: String? {
            switch self {
            case .protocolError(let s): return s
            case .connection(let s): return s
            case .io(let s): return s
            }
        }
    }
    private let host: String
    private let port: UInt16
    private let user: String
    private let password: String
    private let queue = DispatchQueue(label: "rn.ftp.client")
    private var control: NWConnection?
    private var buffer = Data()
    private var lineWaiters: [(String) -> Void] = []

    init(host: String, port: UInt16, user: String, password: String) {
        self.host = host; self.port = port; self.user = user; self.password = password
    }

    /// Downloads `path` to `dest`. Completion on the client's queue.
    func download(path: String, to dest: URL, progress: @escaping (Int64, Int64) -> Void, completion: @escaping (Result<Int64, Error>) -> Void) {
        let conn = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
        control = conn
        var finished = false
        let fail: (Error) -> Void = { err in if !finished { finished = true; conn.cancel(); completion(.failure(err)) } }
        conn.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                self.receiveLoop(conn)
                self.expect([220]) { r1 in
                    guard case .success = r1 else { fail(self.err(r1)); return }
                    self.send("USER \(self.user)") { r2 in
                        guard case .success(let code) = r2, code == 331 || code == 230 else { fail(self.err(r2)); return }
                        let afterLogin: () -> Void = {
                            self.send("TYPE I") { r4 in
                                guard case .success = r4 else { fail(self.err(r4)); return }
                                self.send("SIZE \(path)") { r5 in
                                    var total: Int64 = 0
                                    if case .success(let c) = r5, c == 213, let s = self.lastLine.split(separator: " ").last, let n = Int64(s) { total = n }
                                    self.send("PASV") { r6 in
                                        guard case .success(let c) = r6, c == 227 else { fail(self.err(r6)); return }
                                        guard let (dh, dp) = FTPClient.parsePasv(self.lastLine) else { fail(FTPError.protocolError("Cannot parse PASV reply")); return }
                                        self.openData(host: dh, port: dp, path: path, dest: dest, total: total, progress: progress) { res in
                                            if !finished { finished = true; conn.cancel(); completion(res) }
                                        }
                                    }
                                }
                            }
                        }
                        if code == 230 { afterLogin() } else {
                            self.send("PASS \(self.password)") { r3 in
                                guard case .success(let c) = r3, c == 230 else { fail(self.err(r3)); return }
                                afterLogin()
                            }
                        }
                    }
                }
            case .failed(let e): fail(FTPError.connection("control connection failed: \(e)"))
            case .waiting(let e): fail(FTPError.connection("device not reachable: \(e)"))
            default: break
            }
        }
        conn.start(queue: queue)
    }

    // ---- control channel helpers
    private var lastLine = ""
    private func err(_ r: Result<Int, Error>) -> Error { if case .failure(let e) = r { return e }; return FTPError.protocolError("unexpected reply: \(lastLine)") }

    private func receiveLoop(_ conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let d = data { self.buffer.append(d); self.drainLines() }
            if error != nil || isComplete { self.deliver("421 connection closed"); return }
            self.receiveLoop(conn)
        }
    }
    private func drainLines() {
        while let nl = buffer.firstIndex(of: 0x0A) {
            var lineData = buffer.subdata(in: 0..<nl)
            buffer.removeSubrange(0...nl)
            if lineData.last == 0x0D { lineData.removeLast() }
            let line = String(decoding: lineData, as: UTF8.self)
            // multi-line replies: "123-text" ... "123 text" → only the final line (code + space) completes the reply
            if line.count >= 4, line[line.index(line.startIndex, offsetBy: 3)] == " " || line.count == 3 { deliver(line) }
        }
    }
    private func deliver(_ line: String) {
        lastLine = line
        if !lineWaiters.isEmpty { let w = lineWaiters.removeFirst(); w(line) }
    }
    private func expect(_ codes: [Int], _ cb: @escaping (Result<Int, Error>) -> Void) {
        lineWaiters.append { line in
            let code = Int(line.prefix(3)) ?? 0
            if codes.isEmpty || codes.contains(code) || (codes == [220] && code / 100 == 2) { cb(.success(code)) }
            else { cb(.failure(FTPError.protocolError(line))) }
        }
    }
    private func send(_ cmd: String, _ cb: @escaping (Result<Int, Error>) -> Void) {
        guard let conn = control else { cb(.failure(FTPError.connection("no control connection"))); return }
        lineWaiters.append { line in
            let code = Int(line.prefix(3)) ?? 0
            if code >= 100 && code < 400 { cb(.success(code)) } else { cb(.failure(FTPError.protocolError(line))) }
        }
        conn.send(content: (cmd + "\r\n").data(using: .utf8), completion: .contentProcessed { e in if let e = e { cb(.failure(FTPError.connection("send failed: \(e)"))) } })
    }
    static func parsePasv(_ line: String) -> (String, UInt16)? {
        guard let open = line.firstIndex(of: "("), let close = line.lastIndex(of: ")") else { return nil }
        let parts = line[line.index(after: open)..<close].split(separator: ",").map { Int($0.trimmingCharacters(in: .whitespaces)) ?? -1 }
        guard parts.count == 6, !parts.contains(-1) else { return nil }
        return ("\(parts[0]).\(parts[1]).\(parts[2]).\(parts[3])", UInt16(parts[4] * 256 + parts[5]))
    }

    // ---- data channel
    private func openData(host: String, port: UInt16, path: String, dest: URL, total: Int64, progress: @escaping (Int64, Int64) -> Void, completion: @escaping (Result<Int64, Error>) -> Void) {
        guard FileManager.default.createFile(atPath: dest.path, contents: nil), let fh = try? FileHandle(forWritingTo: dest) else {
            completion(.failure(FTPError.io("cannot create \(dest.lastPathComponent)"))); return
        }
        let data = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
        var received: Int64 = 0
        var closed = false
        let finish: (Result<Int64, Error>) -> Void = { r in
            if closed { return }
            closed = true
            try? fh.close()
            data.cancel()
            completion(r)
        }
        func pump() {
            data.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { chunk, _, isComplete, error in
                if let c = chunk, !c.isEmpty {
                    fh.write(c)
                    received += Int64(c.count)
                    progress(received, total)
                }
                if let e = error { finish(.failure(FTPError.connection("data connection: \(e)"))); return }
                if isComplete { finish(.success(received)); return }
                pump()
            }
        }
        data.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.send("RETR \(path)") { r in
                    if case .failure(let e) = r { finish(.failure(e)) }
                }
                pump()
            case .failed(let e): finish(.failure(FTPError.connection("data connection failed: \(e)")))
            default: break
            }
        }
        data.start(queue: queue)
    }
}

// MARK: - MJPEG socket stream ------------------------------------------------------------------------

/// Reads a raw TCP stream of concatenated JPEG images (FFD8 ... FFD9) as sent by the Race Navigator camera preview.
final class MJPEGSocketStream {
    private let conn: NWConnection
    private let queue = DispatchQueue(label: "rn.mjpeg")
    private var buffer = Data()
    var onFrame: ((Data) -> Void)?
    var onEnd: ((String?) -> Void)?

    init(host: String, port: UInt16) {
        conn = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
    }
    func start() {
        conn.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready: self?.receive()
            case .failed(let e): self?.onEnd?("\(e)")
            case .waiting(let e): self?.onEnd?("\(e)")
            default: break
            }
        }
        conn.start(queue: queue)
    }
    func stop() { conn.cancel() }

    private func receive() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let d = data { self.buffer.append(d); self.extractFrames() }
            if error != nil || isComplete { self.onEnd?(error.map { "\($0)" }); return }
            self.receive()
        }
    }
    private func extractFrames() {
        let soi = Data([0xFF, 0xD8])
        let eoi = Data([0xFF, 0xD9])
        while true {
            guard let start = buffer.range(of: soi) else { if buffer.count > 4 { buffer.removeAll(keepingCapacity: true) }; return }
            guard let end = buffer.range(of: eoi, in: start.upperBound..<buffer.endIndex) else {
                if start.lowerBound > 0 { buffer.removeSubrange(0..<start.lowerBound) }
                if buffer.count > 8 * 1024 * 1024 { buffer.removeAll(keepingCapacity: true) }
                return
            }
            let frame = buffer.subdata(in: start.lowerBound..<end.upperBound)
            buffer.removeSubrange(0..<end.upperBound)
            onFrame?(frame)
        }
    }
}
