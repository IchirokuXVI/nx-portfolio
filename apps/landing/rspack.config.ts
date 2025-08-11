import { withModuleFederation } from "@nx/module-federation/rspack";
import config from "./module-federation.config";

export default withModuleFederation(config, { dts: false });
