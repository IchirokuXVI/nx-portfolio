export interface PushExecutorSchema {
  skipLogin?: boolean;
  registry: string;
  imageName: string;
  dockerfile: string;
  context: 'root' | 'project' | 'dockerfile';
  tag: string;
  noCache: boolean;
}
