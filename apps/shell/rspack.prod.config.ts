import { withModuleFederation } from "@nx/module-federation/rspack";
import config from "./module-federation.config";

export default withModuleFederation({
  ...config,
  remotes: [
    ['landing', 'https://mfe.ichirokuxvi.com/landing'],
    ['odontogram', 'https://mfe.ichirokuxvi.com/odontogram'],
  ],
}, { dts: false });
