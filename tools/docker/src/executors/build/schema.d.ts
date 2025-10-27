export interface BuildExecutorSchema {
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'root' | 'project' | 'dockerfile';
  versionTag: string;
  buildArgs: { [key: string]: string };
  noCache: boolean;
  pushToRegistry: boolean;
}
