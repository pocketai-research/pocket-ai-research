package com.pocketairesearch.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Text, documents and photos shared to the app from other apps through Android's share sheet.
 * MainActivity hands each share intent here; the web app takes it with take() and hears about
 * later ones through the "shared" event (src/shareTarget.ts).
 */
@CapacitorPlugin(name = "SharedContent")
public class SharedContentPlugin extends Plugin {

    // Enough for most PDFs, small enough to pass to the WebView as base64.
    private static final int MAX_BYTES = 25 * 1024 * 1024;

    private Intent pending;

    /** Keeps a share intent for the web app; notify when the app is already running. */
    void receive(Intent intent, boolean notify) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        pending = intent;
        if (notify) notifyListeners("shared", new JSObject());
    }

    /** The waiting share, read once: { text?, subject?, file?: { name, mimeType, data }, error? }. */
    @PluginMethod
    public void take(PluginCall call) {
        Intent intent = pending;
        pending = null;
        JSObject result = new JSObject();
        if (intent == null) {
            call.resolve(result);
            return;
        }
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (text != null) result.put("text", text);
        if (subject != null) result.put("subject", subject);
        Uri uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
        if (uri != null) {
            try {
                result.put("file", readFile(uri, intent.getType()));
            } catch (IOException | SecurityException e) {
                result.put("error", e.getMessage() != null ? e.getMessage() : "The shared file could not be read.");
            }
        }
        call.resolve(result);
    }

    private JSObject readFile(Uri uri, String intentType) throws IOException {
        String name = "Shared file";
        long size = -1;
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn);
            }
        }
        if (size > MAX_BYTES) throw new IOException("The shared file is larger than 25 MB.");
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("The shared file could not be opened.");
            byte[] buffer = new byte[64 * 1024];
            for (int n; (n = in.read(buffer)) != -1; ) {
                out.write(buffer, 0, n);
                if (out.size() > MAX_BYTES) throw new IOException("The shared file is larger than 25 MB.");
            }
        }
        String type = getContext().getContentResolver().getType(uri);
        JSObject file = new JSObject();
        file.put("name", name);
        file.put("mimeType", type != null ? type : intentType != null ? intentType : "application/octet-stream");
        file.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        return file;
    }
}
