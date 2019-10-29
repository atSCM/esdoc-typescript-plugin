import { Plugin } from 'esdoc';
declare class TypescriptPlugin implements Plugin {
    private enabled;
    onStart(ev: any): void;
    onHandleConfig(ev: any): void;
    onHandleCodeParser(ev: any): void;
    private tsParser;
    private getTargetTSNodes;
    private getJSDocNode;
    private transpileComment;
    private applyLOC;
    private applyCallableParam;
    private applyCallableReturn;
    private applyClassMethodGetter;
    private applyClassMethodSetter;
    private applyClassProperty;
    private getTypeFromAnnotation;
    private transpileTS2ES;
}
declare const _default: TypescriptPlugin;
export = _default;
