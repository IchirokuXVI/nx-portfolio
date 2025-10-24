export interface BuildExecutorSchema {
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'root' | 'project' | 'dockerfile';
  tag: string;
  noCache: boolean;
  pushToRegistry: boolean;
}
