package eu.macrix.rndevice;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Capacitor plugin giving the RN Analyzer web app access to an unmodified Race Navigator (Android side,
 * same API as the iOS plugin):
 *  - discover():     mDNS browse for `_racenav._tcp` → {devices: [{name, host, hostname, port}]}
 *  - ftpDownload():  download a file from the device's FTP server into the app cache (events "ftpProgress")
 *  - pgQuery():      read-only SQL against the device's PostgreSQL (fallback for measurements)
 *  - deleteFile():   remove a downloaded temp file
 *  - cameraStart()/cameraStop(): MJPEG frames over a raw TCP socket (events "cameraFrame", "cameraEnd")
 *  - fileBegin()/fileAppend()/share(): stage a file from the web app in chunks and hand it to the Android share sheet
 *    (the Android WebView has no Web Share API; files travel through the app's FileProvider content URI)
 */
@CapacitorPlugin(name = "RnDevice")
public class RnDevicePlugin extends Plugin {
    private final ExecutorService exec = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());
    private MjpegStream camera;

    // ------------------------------------------------------------------ discovery (NSD / mDNS)

    @PluginMethod
    public void discover(final PluginCall call) {
        String type = call.getString("type", "_racenav._tcp.");
        if (type.endsWith(".")) type = type.substring(0, type.length() - 1);
        final int timeout = call.getInt("timeout", 3000);
        final Context ctx = getContext();
        final NsdManager nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
        if (nsd == null) { call.reject("NSD not available"); return; }
        WifiManager wifi = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        final WifiManager.MulticastLock lock = wifi != null ? wifi.createMulticastLock("rn-discover") : null;
        if (lock != null) { lock.setReferenceCounted(false); try { lock.acquire(); } catch (Exception ignored) {} }

        final JSArray results = new JSArray();
        final Set<String> hosts = new HashSet<>();
        final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
        final boolean[] resolving = { false };
        final boolean[] finished = { false };

        // NsdManager resolves only one service at a time → queue + sequential resolution
        final Runnable[] resolveNext = new Runnable[1];
        resolveNext[0] = () -> {
            NsdServiceInfo next;
            synchronized (queue) {
                if (resolving[0] || queue.isEmpty()) return;
                resolving[0] = true;
                next = queue.poll();
            }
            try {
                nsd.resolveService(next, new NsdManager.ResolveListener() {
                    @Override public void onResolveFailed(NsdServiceInfo info, int errorCode) {
                        synchronized (queue) { resolving[0] = false; }
                        main.post(resolveNext[0]);
                    }
                    @Override public void onServiceResolved(NsdServiceInfo info) {
                        String host = bestHost(info);
                        synchronized (queue) {
                            if (host != null && !hosts.contains(host)) {
                                hosts.add(host);
                                JSObject d = new JSObject();
                                d.put("name", info.getServiceName());
                                d.put("host", host);
                                d.put("hostname", info.getHost() != null ? info.getHost().getHostName() : "");
                                d.put("port", info.getPort());
                                results.put(d);
                            }
                            resolving[0] = false;
                        }
                        main.post(resolveNext[0]);
                    }
                });
            } catch (Exception e) {
                synchronized (queue) { resolving[0] = false; }
            }
        };

        final NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override public void onStartDiscoveryFailed(String serviceType, int errorCode) { }
            @Override public void onStopDiscoveryFailed(String serviceType, int errorCode) { }
            @Override public void onDiscoveryStarted(String serviceType) { }
            @Override public void onDiscoveryStopped(String serviceType) { }
            @Override public void onServiceFound(NsdServiceInfo info) {
                synchronized (queue) { queue.add(info); }
                main.post(resolveNext[0]);
            }
            @Override public void onServiceLost(NsdServiceInfo info) { }
        };
        try {
            nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (Exception e) {
            if (lock != null) try { lock.release(); } catch (Exception ignored) {}
            call.reject("discovery failed: " + e.getMessage());
            return;
        }
        main.postDelayed(() -> {
            if (finished[0]) return;
            finished[0] = true;
            try { nsd.stopServiceDiscovery(listener); } catch (Exception ignored) {}
            if (lock != null) try { lock.release(); } catch (Exception ignored) {}
            JSObject ret = new JSObject();
            synchronized (queue) { ret.put("devices", results); }
            call.resolve(ret);
        }, timeout + 500);
    }
    private static String bestHost(NsdServiceInfo info) {
        if (Build.VERSION.SDK_INT >= 34) {
            for (InetAddress a : info.getHostAddresses()) if (a instanceof Inet4Address) return a.getHostAddress();
        }
        InetAddress h = info.getHost();
        return h != null ? h.getHostAddress() : null;
    }

    // ------------------------------------------------------------------ FTP download

    @PluginMethod
    public void ftpDownload(final PluginCall call) {
        final String host = call.getString("host");
        final String path = call.getString("path");
        if (host == null || path == null) { call.reject("host and path are required"); return; }
        final int port = call.getInt("port", 21);
        final String user = call.getString("user", "rtts");
        final String password = call.getString("password", "rtts8888");
        final String fileName = call.getString("fileName", path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path);
        File dir = new File(getContext().getCacheDir(), "rn-downloads");
        dir.mkdirs();
        final File dest = new File(dir, fileName);
        if (dest.exists()) dest.delete();

        exec.execute(() -> {
            final long start = System.currentTimeMillis();
            final long[] lastReport = { 0 };
            try {
                long size = FtpClient.download(host, port, user, password, path, dest, (loaded, total) -> {
                    long now = System.currentTimeMillis();
                    if (now - lastReport[0] > 150) {
                        lastReport[0] = now;
                        double bps = loaded / Math.max(0.001, (now - start) / 1000.0);
                        JSObject ev = new JSObject();
                        ev.put("fileName", fileName); ev.put("loaded", loaded); ev.put("total", total); ev.put("bps", bps);
                        notifyListeners("ftpProgress", ev);
                    }
                });
                JSObject ev = new JSObject();
                ev.put("fileName", fileName); ev.put("loaded", size); ev.put("total", size); ev.put("bps", 0);
                notifyListeners("ftpProgress", ev);
                JSObject ret = new JSObject();
                ret.put("path", dest.getAbsolutePath()); ret.put("size", size); ret.put("fileName", fileName);
                call.resolve(ret);
            } catch (Exception e) {
                dest.delete();
                call.reject("FTP: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String p = call.getString("path");
        if (p != null) new File(p).delete();
        call.resolve();
    }

    // ------------------------------------------------------------------ share sheet (FileProvider)

    private File shareDir() {
        File dir = new File(getContext().getCacheDir(), "rn-share");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** Start a staged file: {name} → {path}. An existing file of that name is replaced. */
    @PluginMethod
    public void fileBegin(PluginCall call) {
        String name = call.getString("name");
        if (name == null || name.isEmpty()) { call.reject("name is required"); return; }
        File f = new File(shareDir(), name.replaceAll("[^A-Za-z0-9._ \\-]", "_"));
        try {
            if (f.exists()) f.delete();
            if (!f.createNewFile()) { call.reject("cannot create " + f.getName()); return; }
        } catch (IOException e) { call.reject(e.getMessage()); return; }
        JSObject r = new JSObject(); r.put("path", f.getAbsolutePath()); call.resolve(r);
    }

    /** Append one base64 chunk to a staged file: {path, base64}. */
    @PluginMethod
    public void fileAppend(PluginCall call) {
        String path = call.getString("path"), b64 = call.getString("base64");
        if (path == null || b64 == null) { call.reject("path and base64 are required"); return; }
        File f = new File(path);
        if (!f.getAbsolutePath().startsWith(shareDir().getAbsolutePath())) { call.reject("path outside the share folder"); return; }
        try (FileOutputStream out = new FileOutputStream(f, true)) {
            out.write(Base64.decode(b64, Base64.DEFAULT));
        } catch (IOException | IllegalArgumentException e) { call.reject(e.getMessage()); return; }
        call.resolve();
    }

    /** Open the Android share sheet for staged files: {paths: [...], mime, title}. */
    @PluginMethod
    public void share(PluginCall call) {
        JSArray arr = call.getArray("paths");
        String mime = call.getString("mime", "*/*");
        String title = call.getString("title", "");
        if (arr == null || arr.length() == 0) { call.reject("paths are required"); return; }
        ArrayList<Uri> uris = new ArrayList<>();
        String authority = getContext().getPackageName() + ".fileprovider"; // the app template's FileProvider, its cache-path covers rn-share/
        try {
            for (int i = 0; i < arr.length(); i++) {
                File f = new File(arr.getString(i));
                if (!f.exists()) { call.reject("missing file " + f.getName()); return; }
                uris.add(FileProvider.getUriForFile(getContext(), authority, f));
            }
        } catch (Exception e) { call.reject(e.getMessage()); return; }
        Intent send = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
        send.setType(mime);
        if (uris.size() == 1) send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        else send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        if (!title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        Intent chooser = Intent.createChooser(send, title.isEmpty() ? null : title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
        call.resolve();
    }

    // ------------------------------------------------------------------ camera preview (MJPEG over TCP)

    @PluginMethod
    public void cameraStart(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        if (host == null || port == null) { call.reject("host and port are required"); return; }
        if (camera != null) camera.stop();
        final long[] lastEmit = { 0 };
        camera = new MjpegStream(host, port, jpeg -> {
            long now = System.currentTimeMillis();
            if (now - lastEmit[0] < 80) return; // ≤ ~12 fps to the WebView
            lastEmit[0] = now;
            JSObject ev = new JSObject();
            ev.put("jpeg", Base64.encodeToString(jpeg, Base64.NO_WRAP));
            ev.put("size", jpeg.length);
            notifyListeners("cameraFrame", ev);
        }, error -> {
            JSObject ev = new JSObject();
            ev.put("error", error == null ? "" : error);
            notifyListeners("cameraEnd", ev);
        });
        exec.execute(camera);
        call.resolve();
    }

    @PluginMethod
    public void cameraStop(PluginCall call) {
        if (camera != null) { camera.stop(); camera = null; }
        call.resolve();
    }

    // ------------------------------------------------------------------ Health Connect (heart rate)

    @PluginMethod
    public void healthAvailable(PluginCall call) {
        JSObject r = new JSObject();
        int st = RnHealth.status(getContext());
        r.put("available", st == 0);
        r.put("status", st == 0 ? "available" : st == 1 ? "install" : "unsupported");
        call.resolve(r);
    }

    /** healthHeartRate({from: ms, to: ms}) -> {samples: [{t, bpm}]}; asks for the Health Connect permission on first use. */
    @PluginMethod
    public void healthHeartRate(PluginCall call) {
        int st = RnHealth.status(getContext());
        if (st != 0) { call.reject(st == 1 ? "Health Connect app is not installed or needs an update" : "Health Connect is not available on this device"); return; }
        RnHealth.hasPermission(getContext(), (granted, err) -> {
            if (err != null) { call.reject("Health Connect: " + err.getMessage()); return null; }
            if (granted) { readHeartRate(call); return null; }
            try {
                Intent intent = RnHealth.requestIntent(getContext());
                getActivity().runOnUiThread(() -> startActivityForResult(call, intent, "healthPermissionResult"));
            } catch (Exception e) { call.reject("Health Connect: " + e.getMessage()); }
            return null;
        });
    }

    @ActivityCallback
    private void healthPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        boolean granted = RnHealth.parseGranted(result.getResultCode(), result.getData());
        if (granted) readHeartRate(call); else call.reject("Permission for heart rate was not granted");
    }

    private void readHeartRate(PluginCall call) {
        final long from = (long) (call.getDouble("from") != null ? call.getDouble("from") : 0);
        final long to = (long) (call.getDouble("to") != null ? call.getDouble("to") : 0);
        if (to <= from) { call.reject("from/to (ms) required"); return; }
        RnHealth.readHeartRate(getContext(), from, to, (list, err) -> {
            if (err != null || list == null) { call.reject("Health Connect: " + (err != null ? err.getMessage() : "no data")); return null; }
            JSArray samples = new JSArray();
            for (kotlin.Pair<Long, Double> p : list) { JSObject o = new JSObject(); o.put("t", p.getFirst()); o.put("bpm", p.getSecond()); samples.put(o); }
            JSObject r = new JSObject(); r.put("samples", samples);
            call.resolve(r);
            return null;
        });
    }

    // ------------------------------------------------------------------ on-device language model (Gemini Nano via ML Kit)

    @PluginMethod
    public void aiAvailable(PluginCall call) {
        RnAi.status(getContext(), st -> {
            JSObject r = new JSObject();
            r.put("available", "available".equals(st) || "downloadable".equals(st));
            r.put("provider", "gemini");
            r.put("status", st);
            call.resolve(r);
            return null;
        });
    }

    @PluginMethod
    public void aiGenerate(PluginCall call) {
        String prompt = call.getString("prompt");
        String instructions = call.getString("instructions", "");
        if (prompt == null) { call.reject("prompt required"); return; }
        RnAi.generate(getContext(), instructions, prompt, (text, err) -> {
            if (err != null || text == null) { call.reject("AI: " + (err != null ? err.getMessage() : "no text")); return null; }
            JSObject r = new JSObject(); r.put("text", text);
            call.resolve(r);
            return null;
        });
    }

    // ------------------------------------------------------------------ PostgreSQL

    @PluginMethod
    public void pgQuery(final PluginCall call) {
        final String host = call.getString("host");
        final String sql = call.getString("sql");
        if (host == null || sql == null) { call.reject("host and sql are required"); return; }
        final String database = call.getString("database", "rtts");
        final String user = call.getString("user", "rtts");
        final String password = call.getString("password", "rtts8888");
        final int port = call.getInt("port", 5432);
        exec.execute(() -> {
            try {
                Class.forName("org.postgresql.Driver");
                Properties props = new Properties();
                props.setProperty("user", user);
                props.setProperty("password", password);
                props.setProperty("ssl", "false");
                props.setProperty("connectTimeout", "5");
                props.setProperty("socketTimeout", "60");
                try (Connection c = DriverManager.getConnection("jdbc:postgresql://" + host + ":" + port + "/" + database, props);
                     Statement st = c.createStatement();
                     ResultSet rs = st.executeQuery(sql)) {
                    ResultSetMetaData md = rs.getMetaData();
                    int n = md.getColumnCount();
                    JSArray columns = new JSArray();
                    List<String> names = new ArrayList<>();
                    for (int i = 1; i <= n; i++) { names.add(md.getColumnLabel(i)); columns.put(md.getColumnLabel(i)); }
                    JSArray rows = new JSArray();
                    while (rs.next()) {
                        JSObject row = new JSObject();
                        for (int i = 1; i <= n; i++) {
                            String v = rs.getString(i);
                            if (v == null) row.put(names.get(i - 1), JSObject.NULL); else row.put(names.get(i - 1), v);
                        }
                        rows.put(row);
                    }
                    JSObject ret = new JSObject();
                    ret.put("rows", rows); ret.put("columns", columns);
                    call.resolve(ret);
                }
            } catch (Throwable e) {
                call.reject("PostgreSQL: " + e.getMessage());
            }
        });
    }

    // ================================================================== helpers

    /** Minimal FTP client: passive mode, binary transfer, progress callback. */
    static final class FtpClient {
        interface Progress { void on(long loaded, long total); }

        static long download(String host, int port, String user, String password, String path, File dest, Progress progress) throws IOException {
            try (Socket ctl = new Socket()) {
                ctl.connect(new InetSocketAddress(host, port), 8000);
                ctl.setSoTimeout(30000);
                BufferedReader in = new BufferedReader(new InputStreamReader(ctl.getInputStream(), StandardCharsets.ISO_8859_1));
                OutputStream out = ctl.getOutputStream();
                String reply = readReply(in);
                if (!reply.startsWith("2")) throw new IOException("unexpected greeting: " + reply);
                reply = cmd(in, out, "USER " + user);
                if (reply.startsWith("331")) reply = cmd(in, out, "PASS " + password);
                if (!reply.startsWith("230")) throw new IOException("login failed: " + reply);
                reply = cmd(in, out, "TYPE I");
                if (!reply.startsWith("2")) throw new IOException("TYPE I failed: " + reply);
                long total = 0;
                reply = cmd(in, out, "SIZE " + path);
                if (reply.startsWith("213")) { try { total = Long.parseLong(reply.substring(4).trim()); } catch (Exception ignored) {} }
                reply = cmd(in, out, "PASV");
                if (!reply.startsWith("227")) throw new IOException("PASV failed: " + reply);
                int open = reply.indexOf('('), close = reply.lastIndexOf(')');
                if (open < 0 || close < open) throw new IOException("cannot parse PASV reply: " + reply);
                String[] p = reply.substring(open + 1, close).split(",");
                if (p.length != 6) throw new IOException("cannot parse PASV reply: " + reply);
                String dataHost = p[0].trim() + "." + p[1].trim() + "." + p[2].trim() + "." + p[3].trim();
                int dataPort = Integer.parseInt(p[4].trim()) * 256 + Integer.parseInt(p[5].trim());
                if (dataHost.equals("0.0.0.0")) dataHost = host;
                long received = 0;
                try (Socket data = new Socket()) {
                    data.connect(new InetSocketAddress(dataHost, dataPort), 8000);
                    data.setSoTimeout(60000);
                    reply = cmd(in, out, "RETR " + path);
                    if (!reply.startsWith("1")) throw new IOException("RETR failed: " + reply);
                    try (InputStream ds = data.getInputStream(); FileOutputStream fo = new FileOutputStream(dest)) {
                        byte[] buf = new byte[1 << 16];
                        int r;
                        while ((r = ds.read(buf)) > 0) {
                            fo.write(buf, 0, r);
                            received += r;
                            progress.on(received, total);
                        }
                    }
                }
                try { readReply(in); } catch (Exception ignored) {} // 226 transfer complete
                try { out.write("QUIT\r\n".getBytes(StandardCharsets.ISO_8859_1)); out.flush(); } catch (Exception ignored) {}
                return received;
            }
        }
        private static String cmd(BufferedReader in, OutputStream out, String c) throws IOException {
            out.write((c + "\r\n").getBytes(StandardCharsets.ISO_8859_1)); out.flush();
            return readReply(in);
        }
        /** Reads one (possibly multi-line) reply and returns its final "xyz text" line. */
        private static String readReply(BufferedReader in) throws IOException {
            String line;
            while ((line = in.readLine()) != null) {
                if (line.length() >= 4 && Character.isDigit(line.charAt(0)) && line.charAt(3) == ' ') return line;
                if (line.length() == 3 && Character.isDigit(line.charAt(0))) return line;
            }
            throw new IOException("connection closed");
        }
    }

    /** Reads a raw TCP stream of concatenated JPEG images (FFD8 … FFD9), as sent by the RN camera preview. */
    static final class MjpegStream implements Runnable {
        interface Frame { void on(byte[] jpeg); }
        interface End { void on(String error); }
        private final String host; private final int port; private final Frame onFrame; private final End onEnd;
        private volatile boolean stopped = false;
        private Socket socket;

        MjpegStream(String host, int port, Frame onFrame, End onEnd) { this.host = host; this.port = port; this.onFrame = onFrame; this.onEnd = onEnd; }

        void stop() { stopped = true; try { if (socket != null) socket.close(); } catch (Exception ignored) {} }

        @Override public void run() {
            String error = null;
            try {
                socket = new Socket();
                socket.connect(new InetSocketAddress(host, port), 6000);
                socket.setSoTimeout(15000);
                InputStream in = socket.getInputStream();
                ByteArrayOutputStream buf = new ByteArrayOutputStream(1 << 18);
                byte[] chunk = new byte[1 << 16];
                int r;
                while (!stopped && (r = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, r);
                    byte[] b = buf.toByteArray();
                    int consumed = 0;
                    while (true) {
                        int soi = indexOf(b, consumed, (byte) 0xFF, (byte) 0xD8);
                        if (soi < 0) { consumed = Math.max(consumed, b.length - 1); break; }
                        int eoi = indexOf(b, soi + 2, (byte) 0xFF, (byte) 0xD9);
                        if (eoi < 0) { consumed = soi; break; }
                        byte[] frame = new byte[eoi + 2 - soi];
                        System.arraycopy(b, soi, frame, 0, frame.length);
                        onFrame.on(frame);
                        consumed = eoi + 2;
                    }
                    if (consumed > 0) {
                        buf.reset();
                        if (consumed < b.length) buf.write(b, consumed, b.length - consumed);
                    }
                    if (buf.size() > (8 << 20)) buf.reset(); // garbage guard
                }
            } catch (Exception e) {
                if (!stopped) error = String.valueOf(e.getMessage());
            } finally {
                try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                onEnd.on(error);
            }
        }
        private static int indexOf(byte[] b, int from, byte a1, byte a2) {
            for (int i = Math.max(0, from); i < b.length - 1; i++) if (b[i] == a1 && b[i + 1] == a2) return i;
            return -1;
        }
    }
}
