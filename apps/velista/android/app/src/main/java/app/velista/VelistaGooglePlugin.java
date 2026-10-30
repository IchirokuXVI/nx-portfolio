package app.velista;

import android.app.Activity;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CredentialOption;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException;
import androidx.credentials.exceptions.GetCredentialUnsupportedException;
import androidx.credentials.exceptions.NoCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import java.util.concurrent.Executor;

/**
 * Google sign in through Android's Credential Manager (velista plan 0175).
 *
 * Google refuses its sign in page inside an embedded WebView, so the app asks Android for a
 * Google ID token instead and the gateway trades it for the pair (backend plan 0238). A local
 * plugin and not a package (D2): it is this one file, it handles a credential, and every option
 * it passes to Google is written here.
 *
 * Rejection codes, read by `NativeGoogleCredential` in `libs/velista/native`:
 * `cancelled` (the person closed the sheet), `no_credential` (no account on the phone can
 * answer), `unavailable` (no Play services or no provider), `failed` (anything else). The token
 * is resolved to the WebView and never logged here.
 */
@CapacitorPlugin(name = "VelistaGoogle")
public class VelistaGooglePlugin extends Plugin {

    private CredentialManager credentials;
    private Executor mainThread;

    @Override
    public void load() {
        credentials = CredentialManager.create(getContext());
        mainThread = ContextCompat.getMainExecutor(getContext());
    }

    /**
     * Ask for a Google ID token whose audience is the server client and whose nonce is the one
     * the gateway minted.
     *
     * Silent asks only for an account that already approved this app, and lets Android pick it
     * with no tap. Android shows nothing or answers `no_credential`; when more than one such
     * account is on the phone, or auto select is cooling down after a dismissal, it can show a
     * picker of them instead. Interactive shows the "Sign in with Google" sheet, which also lets
     * the person add an account.
     */
    @PluginMethod
    public void getIdToken(PluginCall call) {
        String serverClientId = call.getString("serverClientId");
        String nonce = call.getString("nonce");
        boolean silent = Boolean.TRUE.equals(call.getBoolean("silent", false));
        if (isBlank(serverClientId) || isBlank(nonce)) {
            call.reject("serverClientId and nonce are required", "failed");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity to show the sheet over", "failed");
            return;
        }

        CredentialOption option = silent
            ? new GetGoogleIdOption.Builder()
                .setServerClientId(serverClientId)
                .setNonce(nonce)
                .setFilterByAuthorizedAccounts(true)
                .setAutoSelectEnabled(true)
                .build()
            : new GetSignInWithGoogleOption.Builder(serverClientId).setNonce(nonce).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();

        credentials.getCredentialAsync(
            activity,
            request,
            null,
            mainThread,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    resolveToken(call, response.getCredential());
                }

                @Override
                public void onError(@NonNull GetCredentialException error) {
                    call.reject(error.getClass().getSimpleName(), codeOf(error));
                }
            }
        );
    }

    /**
     * Stop Android choosing an account by itself, after a sign out (D4). The next silent request
     * then answers `no_credential` until the person picks Google again.
     */
    @PluginMethod
    public void forget(PluginCall call) {
        credentials.clearCredentialStateAsync(
            new ClearCredentialStateRequest(),
            null,
            mainThread,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void result) {
                    call.resolve();
                }

                @Override
                public void onError(@NonNull ClearCredentialException error) {
                    call.reject(error.getClass().getSimpleName(), "failed");
                }
            }
        );
    }

    private static void resolveToken(PluginCall call, Credential credential) {
        if (
            !(credential instanceof CustomCredential) ||
            !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())
        ) {
            call.reject("Android answered with a credential that is not a Google ID token", "failed");
            return;
        }

        try {
            GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
            JSObject answer = new JSObject();
            answer.put("idToken", google.getIdToken());
            call.resolve(answer);
        } catch (Exception error) {
            // The parsing exception's message can quote the bundle, so only its type leaves.
            call.reject(error.getClass().getSimpleName(), "failed");
        }
    }

    private static String codeOf(GetCredentialException error) {
        if (error instanceof GetCredentialCancellationException) {
            return "cancelled";
        }
        if (error instanceof NoCredentialException) {
            return "no_credential";
        }
        if (error instanceof GetCredentialProviderConfigurationException || error instanceof GetCredentialUnsupportedException) {
            return "unavailable";
        }
        return "failed";
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
