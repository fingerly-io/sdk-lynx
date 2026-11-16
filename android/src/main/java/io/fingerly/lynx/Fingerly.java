package io.fingerly.lynx;

import android.content.Context;
import androidx.annotation.Nullable;
import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxNativeModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;
import io.fingerly.lynx.generated.FingerlySpec;
import io.fingerly.sdk.bridge.BridgeCallback;
import io.fingerly.sdk.bridge.FingerlyBridge;
import org.json.JSONException;
import org.json.JSONObject;

/** Thin Lynx adapter. Collection, transport and scoring remain in the Android SDK. */
@LynxNativeModule(name = "Fingerly")
public final class Fingerly extends FingerlySpec {
  private final Context applicationContext;

  public Fingerly(LynxContext context) {
    super(context);
    applicationContext = context.getContext().getApplicationContext();
  }

  @Override
  @LynxMethod
  public void configure(
      String apiKey,
      String endpoint,
      String platform,
      String consent,
      double playIntegrityCloudProjectNumber) {
    // `src/index.ts` always sends a consent, `pending` when the app passed none,
    // so the state is set rather than left as it was.
    //
    // The project number is 0 when the app passed none; `FingerlyBridge.configure`
    // takes a nullable Long (`<= 0` or `null` leaves Play Integrity token requests off).
    Long projectNumber =
        playIntegrityCloudProjectNumber > 0
            ? Long.valueOf((long) playIntegrityCloudProjectNumber)
            : null;
    FingerlyBridge.configure(
        applicationContext, apiKey, endpoint, platform, consent, projectNumber);
  }

  @Override
  @LynxMethod
  public void setConsent(String state) {
    FingerlyBridge.setConsent(state);
  }

  @Override
  @LynxMethod
  public void identify(
      @Nullable String tag, boolean submit, boolean automatic, Object success, Object failure) {
    FingerlyBridge.identify(tag, submit, automatic, settle(success, failure));
  }

  @Override
  @LynxMethod
  public void collect(Object success, Object failure) {
    FingerlyBridge.collect(settle(success, failure));
  }

  /**
   * Atomically deletes the local install record and the persistent AndroidKeyStore v3
   * attestation signing key. Strictly for user-initiated GDPR/privacy erasure (such as a
   * right-to-erasure request or account deletion; never routine logout). Needs neither
   * `configure` nor consent. A failure is `delete_failed`, matching the iOS adapter.
   */
  @Override
  @LynxMethod
  public void deleteStoredIdentity(Object success, Object failure) {
    boolean deleted;
    try {
      deleted = FingerlyBridge.deleteStoredIdentity(applicationContext);
    } catch (RuntimeException error) {
      deleted = false;
    }
    if (deleted) {
      ((Callback) success).invoke();
    } else {
      ((Callback) failure).invoke(
          errorJson("delete_failed", "Fingerly could not delete its stored install record"));
    }
  }

  @Override
  @LynxMethod
  public String sdkVersion() {
    return FingerlyBridge.sdkVersion();
  }

  private static BridgeCallback settle(Object success, Object failure) {
    Callback successCallback = (Callback) success;
    Callback failureCallback = (Callback) failure;
    return new BridgeCallback() {
      @Override
      public void onSuccess(String json) {
        successCallback.invoke(json);
      }

      @Override
      public void onError(String code, String message) {
        failureCallback.invoke(errorJson(code, message, null));
      }

      @Override
      public void onError(String code, String message, Long retryAfterMs) {
        failureCallback.invoke(errorJson(code, message, retryAfterMs));
      }
    };
  }

  private static String errorJson(String code, String message) {
    return errorJson(code, message, null);
  }

  private static String errorJson(String code, String message, Long retryAfterMs) {
    try {
      JSONObject error = new JSONObject().put("code", code).put("message", message);
      if (retryAfterMs != null) {
        error.put("retryAfterMs", retryAfterMs.longValue());
      }
      return error.toString();
    } catch (JSONException ignored) {
      return "{\"code\":\"-1\",\"message\":\"Native SDK failure\"}";
    }
  }
}
