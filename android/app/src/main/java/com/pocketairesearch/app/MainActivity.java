package com.pocketairesearch.app;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Cross-origin isolation lets the AI engine (wllama) use several CPU threads
        // through SharedArrayBuffer. The web build gets the same headers from vite.config.ts.
        bridge.setWebViewClient(
            new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    WebResourceResponse response = super.shouldInterceptRequest(view, request);
                    if (response != null) {
                        Map<String, String> headers = new HashMap<>();
                        if (response.getResponseHeaders() != null) {
                            headers.putAll(response.getResponseHeaders());
                        }
                        headers.put("Cross-Origin-Opener-Policy", "same-origin");
                        headers.put("Cross-Origin-Embedder-Policy", "require-corp");
                        response.setResponseHeaders(headers);
                    }
                    return response;
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    // The WebView died, usually out of memory while running the model. Capacitor's
                    // default lets Android kill the whole app; restart the activity instead so
                    // the web app can explain what happened and step its settings down.
                    runOnUiThread(MainActivity.this::recreate);
                    return true;
                }
            }
        );
    }
}
