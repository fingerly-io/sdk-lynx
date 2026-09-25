package io.fingerly.lynx;

import android.content.Context;
import androidx.annotation.Nullable;
import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxNativeModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;
import io.fingerly.lynx.generated.FingerlySpec;
import io.fingerly.sdk.bridge.FingerlyBridge;
import io.fingerly.sdk.bridge.BridgeCallback;
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
  public void configure(String apiKey, String endpoint, String platform, String consent) {
    // `src/index.ts` always sends a consent, `pending` when the app passed none,
    // so the state is set rather than left as it was.
    FingerlyBridge.configure(applicationContext, apiKey, endpoint, platform, consent);
  }

  @Override
  @LynxMethod
  public void setConsent(String state) {
    FingerlyBridge.setConsent(state);
  }

  @Override
  @LynxMethod
  public void identify(@Nullable String tag, boolean submit, Object success, Object failure) {
    FingerlyBridge.identify(tag, submit, settle(success, failure));
  }

  @Override
  @LynxMethod
  public void collect(Object success, Object failure) {
    FingerlyBridge.collect(settle(success, failure));
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
        failureCallback.invoke(errorJson(code, message));
      }
    };
  }

  private static String errorJson(String code, String message) {
    try {
      return new JSONObject().put("code", code).put("message", message).toString();
    } catch (JSONException ignored) {
      return "{\"code\":\"-1\",\"message\":\"Native SDK failure\"}";
    }
  }
}
