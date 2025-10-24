export interface BuildExecutorSchema {
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'root' | 'project' | 'dockerfile';
  versionTag: string;
  buildArgs: { [key: string]: string };
  addNodeEnv: boolean;
  noCache: boolean;
  pushToRegistry: boolean;
}
