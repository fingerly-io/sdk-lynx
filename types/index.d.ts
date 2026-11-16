export { Fingerly, requireFingerly, type FingerlySpec } from '../generated/Fingerly';
export {
  ConsentError,
  FingerlyClient,
  FingerlyError,
  /**
   * Strictly for user-initiated GDPR / privacy right-to-erasure requests or
   * account deletion (never routine logout). Deletes the local `install_id`
   * record and hardware attestation key state on the device.
   */
  deleteStoredIdentity,
  load,
  nativeVersion,
} from '../src/index';
export type {
  Confidence,
  ConsentState,
  EngineIdentity,
  FingerlyEvent,
  FingerlyEventBase,
  FingerlyMobileEvent,
  FingerlyOptions,
  FingerlyWebEvent,
  Identification,
  IdentificationConfidence,
  IdentifyOptions,
  IdentifyResult,
  IdentifySubmission,
  IdentifyTrigger,
  IntegrityReport,
  IpGeolocation,
  IpInfoV4,
  Lie,
  LieKind,
  MobileFingerlyOptions,
  MobileIdentifyOptions,
  NativeIdentifyResult,
  RawReportResult,
  RiskSignal,
  SdkPlatform,
  SignalOutcome,
  SignalReport,
  SignalStatus,
  SuspectLevel,
  Velocity,
  VelocityWindow,
} from '../src/index';
