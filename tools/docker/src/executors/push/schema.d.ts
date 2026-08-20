export interface PushExecutorSchema {
  skipLogin?: boolean;
  // When true, do not (re)build the image before pushing — it was already built and
  // loaded by the build executor. Set automatically when build calls push.
  skipBuild?: boolean;
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'root' | 'project' | 'dockerfile';
  versionTags: string[];
  buildArgs: { [key: string]: string };
  noCache: boolean;
}
