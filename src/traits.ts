/**
 * Browserbase SDK trait surface -- hand-written.
 *
 * Re-exports the generic protocol traits from core so the generated service
 * module imports everything from one place.
 */
export {
  Body,
  Header,
  Query,
  Label,
  Http,
  HttpBody,
  FormDataFile,
  type HttpTrait,
} from "@distilled.cloud/core/trait";

export {
  SensitiveValue,
  RawResponseRoot,
  BinaryResponse,
} from "@distilled.cloud/core/protocol-rest";
