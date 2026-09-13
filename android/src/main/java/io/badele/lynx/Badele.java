package io.badele.lynx;

import android.content.Context;
import androidx.annotation.Nullable;
import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxNativeModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;
import io.badele.lynx.generated.BadeleSpec;
import io.badele.sdk.bridge.BadeleBridge;
import io.badele.sdk.bridge.BridgeCallback;
import org.json.JSONException;
import org.json.JSONObject;

/** Thin Lynx adapter. Collection, transport and scoring remain in the Android SDK. */
@LynxNativeModule(name = "Badele")
public final class Badele extends BadeleSpec {
  private final Context applicationContext;

  public Badele(LynxContext context) {
    super(context);
    applicationContext = context.getContext().getApplicationContext();
  }

  @Override
  @LynxMethod
  public void configure(String apiKey, String endpoint, String platform) {
    BadeleBridge.configure(applicationContext, apiKey, endpoint, platform);
  }

  @Override
  @LynxMethod
  public void identify(@Nullable String tag, boolean submit, Object success, Object failure) {
    BadeleBridge.identify(tag, submit, settle(success, failure));
  }

  @Override
  @LynxMethod
  public void collect(Object success, Object failure) {
    BadeleBridge.collect(settle(success, failure));
  }

  @Override
  @LynxMethod
  public String sdkVersion() {
    return BadeleBridge.sdkVersion();
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
