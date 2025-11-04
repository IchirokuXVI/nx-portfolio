export interface PushExecutorSchema {
  skipLogin?: boolean;
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'root' | 'project' | 'dockerfile';
  versionTags: string[];
  buildArgs: { [key: string]: string };
  noCache: boolean;
}
