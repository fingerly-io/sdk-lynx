package io.fingerly.lynx;

import androidx.annotation.Nullable;
import io.fingerly.sdk.AppChecksProvider;
import io.fingerly.sdk.PlayIntegrityProvider;
import io.fingerly.sdk.appchecks.FingerlyAppChecks;
import io.fingerly.sdk.playintegrity.FingerlyPlayIntegrity;

/**
 * The optional {@code io.fingerly:fingerly-app-checks} and {@code
 * io.fingerly:fingerly-play-integrity} providers, found the same way the React Native module
 * finds them.
 *
 * <p>Both artifacts are {@code compileOnly} here, so the host app decides whether they ship. When
 * the app links one, the constructor runs; when it does not, the class is missing at run time and
 * the constructor throws a {@link LinkageError} ({@code NoClassDefFoundError}), which reads as
 * "not installed".
 */
final class OptionalProviders {
  static final String PLAY_INTEGRITY_UNAVAILABLE = "play_integrity_unavailable";

  static final String PLAY_INTEGRITY_UNAVAILABLE_MESSAGE =
      "playIntegrityCloudProjectNumber was set but the io.fingerly:fingerly-play-integrity "
          + "artifact is not on the classpath";

  private OptionalProviders() {}

  @Nullable
  static AppChecksProvider appChecks() {
    try {
      return new FingerlyAppChecks();
    } catch (LinkageError absent) {
      return null;
    }
  }

  @Nullable
  static PlayIntegrityProvider playIntegrity() {
    try {
      return new FingerlyPlayIntegrity();
    } catch (LinkageError absent) {
      return null;
    }
  }

  /**
   * The configuration error for a project number that no provider can use, or null when the
   * configuration is complete. A project number needs the artifact's {@code provider} or one the
   * app registered by hand ({@code registeredByHand}). No project number is always complete: Play
   * Integrity is simply off.
   */
  @Nullable
  static String playIntegrityError(
      @Nullable Long projectNumber,
      @Nullable PlayIntegrityProvider provider,
      boolean registeredByHand) {
    return projectNumber != null && provider == null && !registeredByHand
        ? PLAY_INTEGRITY_UNAVAILABLE_MESSAGE
        : null;
  }
}
