package io.fingerly.lynx;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import io.fingerly.sdk.PlayIntegrityProvider;
import java.lang.reflect.Proxy;
import org.junit.Test;

public final class OptionalProvidersTest {

  /** The unit test classpath has no `compileOnly` artifact, as an app that did not link it. */
  @Test
  public void providersAreAbsentWhenTheArtifactsAreNotLinked() {
    assertNull(OptionalProviders.playIntegrity());
    assertNull(OptionalProviders.appChecks());
  }

  @Test
  public void projectNumberWithoutProviderIsAConfigurationError() {
    assertEquals(
        OptionalProviders.PLAY_INTEGRITY_UNAVAILABLE_MESSAGE,
        OptionalProviders.playIntegrityError(123456789L, null, false));
  }

  @Test
  public void projectNumberWithProviderRegisteredByHandIsComplete() {
    assertNull(OptionalProviders.playIntegrityError(123456789L, null, true));
  }

  @Test
  public void noProjectNumberAndNoProviderIsComplete() {
    assertNull(OptionalProviders.playIntegrityError(null, null, false));
  }

  @Test
  public void projectNumberWithProviderIsComplete() {
    PlayIntegrityProvider provider =
        (PlayIntegrityProvider)
            Proxy.newProxyInstance(
                PlayIntegrityProvider.class.getClassLoader(),
                new Class<?>[] {PlayIntegrityProvider.class},
                (proxy, method, args) -> null);
    assertNull(OptionalProviders.playIntegrityError(123456789L, provider, false));
  }
}
