package app.velista;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * What the over the air path must know about this APK and must not take from a bundle
 * (velista plan 0180). Every value is compiled in by Gradle from build-android.mjs, so a
 * downloaded bundle cannot change the key that judges the next bundle (D5), and the id of
 * the built-in bundle never travels through the web build (D8).
 *
 * `info()` resolves `nativeApi` (the native compatibility key of native-api.json, D4),
 * `otaBaseUrl` (where the flavor's manifest lives, empty when OTA is off), `otaPublicKey`
 * (the flavor's PEM, empty until the owner commits one) and `builtinBundle` (the version and
 * commit of the bundle inside the APK).
 */
@CapacitorPlugin(name = "VelistaNativeInfo")
public class VelistaNativeInfoPlugin extends Plugin {

    @PluginMethod
    public void info(PluginCall call) {
        JSObject result = new JSObject();
        result.put("nativeApi", BuildConfig.VELISTA_NATIVE_API);
        result.put("otaBaseUrl", BuildConfig.VELISTA_OTA_BASE_URL);
        result.put("otaPublicKey", BuildConfig.VELISTA_OTA_PUBLIC_KEY);
        result.put("builtinBundle", BuildConfig.VELISTA_BUILTIN_BUNDLE);
        call.resolve(result);
    }
}
