package com.vibeword.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.Toast;
import android.widget.FrameLayout;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private TextToSpeech speech;
    private boolean speechReady;
    private String pendingExport;
    private final ExecutorService network = Executors.newFixedThreadPool(3);
    private final ConcurrentMap<String, RequestTask> requests = new ConcurrentHashMap<>();

    private static final class RequestTask {
        volatile boolean cancelled;
        volatile HttpURLConnection connection;
        void cancel() { cancelled = true; if (connection != null) connection.disconnect(); }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xfff1f5f9);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(), "VibeAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..")) return response(403, "Forbidden");
                try {
                    String mime = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".html") ? "text/html" : path.endsWith(".png") ? "image/png" : "application/octet-stream";
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https: http:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open("web" + path));
                } catch (IOException e) { return response(404, "Not Found"); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep the bridge exclusively in our bundled document. External links use the browser.
                Uri uri = request.getUrl();
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (Exception e) { toast("无法打开链接"); }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("确定", (d,w) -> result.confirm()).setNegativeButton("取消", (d,w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
            @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("知道了", (d,w) -> result.confirm())
                    .setOnCancelListener(d -> result.confirm()).show();
                return true;
            }
        });
        speech = new TextToSpeech(this, status -> speechReady = status == TextToSpeech.SUCCESS);
        web.loadUrl("https://" + HOST + "/index.html");
    }

    private static WebResourceResponse response(int code, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason, Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private void toast(String message) { runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show()); }

    public final class Bridge {
        @JavascriptInterface public void speak(String text, String language) {
            runOnUiThread(() -> {
                if (!speechReady) { toast("语音引擎尚未就绪，请稍后重试"); return; }
                int availability = speech.setLanguage("zh".equals(language) ? Locale.SIMPLIFIED_CHINESE : Locale.US);
                if (availability < 0) { toast("系统尚未安装该语言的语音数据"); return; }
                speech.setSpeechRate("zh".equals(language) ? 0.95f : 0.85f);
                speech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "vibe-word");
            });
        }
        @JavascriptInterface public void stopSpeech() { runOnUiThread(() -> speech.stop()); }
        @JavascriptInterface public void exportMarkdown(String content, String filename) {
            runOnUiThread(() -> {
                if (pendingExport != null) { toast("请先完成当前导出"); return; }
                pendingExport = content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("text/markdown")
                    .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, filename);
                try { startActivityForResult(intent, 100); }
                catch (Exception e) { pendingExport = null; toast("无法打开文件保存窗口"); }
            });
        }
        @JavascriptInterface public void cancelRequest(String id) {
            RequestTask task = requests.get(id);
            if (task != null) task.cancel();
        }
        @JavascriptInterface public void request(String id, String url, String headers, String body) {
            RequestTask task = new RequestTask();
            requests.put(id, task);
            network.execute(() -> {
                try {
                    if (task.cancelled) return;
                    URL endpoint = new URL(url);
                    if (!endpoint.getProtocol().equals("https") && !endpoint.getProtocol().equals("http")) throw new IOException("仅支持 HTTP/HTTPS API");
                    if (!endpoint.getPath().endsWith("/chat/completions") && !endpoint.getPath().endsWith("/images/generations")) throw new IOException("不支持的 API 路径");
                    HttpURLConnection connection = (HttpURLConnection) endpoint.openConnection();
                    task.connection = connection;
                    if (task.cancelled) return;
                    connection.setInstanceFollowRedirects(false); // Never forward API keys to a redirected host.
                    connection.setConnectTimeout(30000);
                    connection.setReadTimeout(120000);
                    connection.setRequestMethod("POST");
                    connection.setDoOutput(true);
                    JSONObject fields = new JSONObject(headers);
                    Iterator<String> keys = fields.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        if (key.equalsIgnoreCase("content-type") || key.equalsIgnoreCase("authorization")) connection.setRequestProperty(key, fields.getString(key));
                    }
                    try (OutputStream out = connection.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
                    int status = connection.getResponseCode();
                    InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    if (stream != null) try (InputStream input = stream) {
                        byte[] buffer = new byte[8192]; int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (task.cancelled) return;
                            if (bytes.size() + count > 32 * 1024 * 1024) throw new IOException("API 响应过大");
                            bytes.write(buffer, 0, count);
                        }
                    }
                    if (!task.cancelled) reply(id, status, bytes.toString("UTF-8"), null);
                } catch (Exception e) {
                    if (!task.cancelled) reply(id, 0, "", "网络请求失败，请检查 API 地址、网络连接或稍后重试");
                } finally {
                    if (task.connection != null) task.connection.disconnect();
                    requests.remove(id);
                }
            });
        }
    }
    private void reply(String id, int status, String body, String error) {
        String js = "window.__vibeNativeResponse && window.__vibeNativeResponse(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(body) + "," + (error == null ? "null" : JSONObject.quote(error)) + ")";
        runOnUiThread(() -> { if (!isDestroyed()) web.evaluateJavascript(js, null); });
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != 100) return;
        String content = pendingExport; pendingExport = null;
        if (result == RESULT_OK && data != null && data.getData() != null && content != null) {
            Uri destination = data.getData();
            network.execute(() -> {
                try (OutputStream output = getContentResolver().openOutputStream(destination)) {
                    if (output == null) throw new IOException();
                    output.write(content.getBytes(StandardCharsets.UTF_8)); toast("Markdown 已导出");
                } catch (IOException e) { toast("导出失败，请重试"); }
            });
        }
    }
    @Override protected void onDestroy() {
        requests.values().forEach(RequestTask::cancel); network.shutdownNow();
        if (speech != null) { speech.stop(); speech.shutdown(); }
        web.removeJavascriptInterface("VibeAndroid"); web.destroy();
        super.onDestroy();
    }
}
