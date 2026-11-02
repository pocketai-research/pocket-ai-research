package com.pocketairesearch.app;

import android.os.Bundle;
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
            }
        );
    }
}
