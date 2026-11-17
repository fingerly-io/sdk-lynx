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
  FingerlyOptions,
  IdentifyOptions,
  IdentifyResult,
  IdentifySubmission,
  IdentifyTrigger,
  IntegrityReport,
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
} from '../src/index';
