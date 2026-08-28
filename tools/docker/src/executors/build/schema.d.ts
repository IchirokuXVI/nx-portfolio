export interface BuildExecutorSchema {
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'root' | 'project' | 'dockerfile';
  versionTags: string[];
  buildArgs: { [key: string]: string };
  // Names of environment variables to forward as build args (if set). Keeps the
  // executor generic: it forwards whatever the project asks for without knowing
  // what the values mean.
  forwardEnv?: string[];
  noCache: boolean;
  // Buildx cache backend: local (default), gha, registry, or none.
  cache?: 'local' | 'gha' | 'registry' | 'none';
  // Cache export mode: max (default) or min.
  cacheMode?: 'max' | 'min';
  // Cache scope/key (gha backend); defaults to the image name.
  cacheScope?: string;
  pushToRegistry: boolean;
  skipLogin?: boolean;
}
