import { composePlugins } from '@nx/rspack/src/utils/config';
import { withNx } from '@nx/rspack/src/utils/with-nx';
import { withModuleFederation } from "@nx/module-federation/rspack";
import merge from 'webpack-merge';
import commonConfig from './rspack.common.config';
import mfeConfig from "./module-federation.config";

export default composePlugins(
  withNx(),
  async (config, { options, context }) => {
    const federatedModules = await withModuleFederation(
      { ...mfeConfig },
      { dts: false }
    );

    return merge(
      federatedModules(config, { options, context }),
      {
        ...commonConfig
      }
    )
  }
);
