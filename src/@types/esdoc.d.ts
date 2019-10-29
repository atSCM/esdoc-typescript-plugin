declare module 'esdoc' {
  type CodeParser = (code: string) => {}[];
  type PluginEvent<D> = {
    data: D;
  };

  type PluginEventListener<D = {}> = (event: PluginEvent<D>) => void;

  export interface Plugin {
    onStart?: PluginEventListener;
    onHandlePlugins?: PluginEventListener<{ plugins: [] }>;
    onHandleConfig?: PluginEventListener<{ config: {} }>;
    onHandleCode?: PluginEventListener<{ code: string }>;
    onHandleCodeParser?: PluginEventListener<{ parser: CodeParser }>;
    onHandleAST?: PluginEventListener;
    onHandleDocs?: PluginEventListener;
    onPublish?: PluginEventListener;
    onHandleContent?: PluginEventListener;
    onComplete?: PluginEventListener;
  }
}

declare module 'esdoc/out/src/Parser/CommentParser' {
  export default class CommentParser {
    public static parse(node: {}): {}[];
    public static buildComment(tags: {}[]): string;
  }
}
