export interface PushExecutorSchema {
  skipLogin?: boolean;
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'root' | 'project' | 'dockerfile';
  buildArgs: { [key: string]: string };
  versionTag: string;
  noCache: boolean;
}
