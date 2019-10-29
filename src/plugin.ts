/* eslint-disable no-param-reassign */

import * as path from 'path';
import ts, { JsxEmit, SourceFile, Node } from 'typescript';
import CommentParser from '/Users/lukas/Downloads/delete/external/node_modules/esdoc/out/src/Parser/CommentParser'; // eslint-disable-line import/no-unresolved
import { Plugin } from 'esdoc'; // eslint-disable-line import/no-unresolved

class TypescriptPlugin implements Plugin {
  private enabled = true;

  public onStart(ev): void {
    if (!ev.data.option) return;
    if ('enable' in ev.data.option) this.enabled = ev.data.option.enable;
  }

  public onHandleConfig(ev): void {
    if (!this.enabled) return;

    if (!ev.data.config.includes) ev.data.config.includes = [];

    ev.data.config.includes.push('\\.ts$', '\\.js$');
  }

  public onHandleCodeParser(ev): void {
    if (!this.enabled) return;

    const esParser = ev.data.parser;
    const esParserOption = ev.data.parserOption;
    const filePath = ev.data.filePath;

    ev.data.parser = (code: string) => this.tsParser(esParser, esParserOption, filePath, code);
  }

  // https://github.com/Microsoft/TypeScript/blob/master/src/services/transpile.ts#L26
  private tsParser(esParser, esParserOption, filePath, code): void {
    // return if not typescript
    if (path.extname(filePath) !== '.ts') return esParser(code);

    // create ast and get target nodes
    const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
    const nodes = this.getTargetTSNodes(sourceFile);

    // rewrite jsdoc comment
    nodes.sort((a, b) => b.pos - a.pos); // hack: transpile comment with reverse
    const codeChars = [...code];
    for (const node of nodes) {
      const jsDocNode = this.getJSDocNode(node);
      if (jsDocNode && jsDocNode.comment)
        codeChars.splice(jsDocNode.pos, jsDocNode.end - jsDocNode.pos);

      const newComment = this.transpileComment(node, jsDocNode ? jsDocNode.comment : '', code);
      codeChars.splice(node.pos, 0, newComment);
    }
    const newTSCode = codeChars.join('');

    // transpile typescript to es
    const esCode = this.transpileTS2ES(newTSCode, esParserOption);

    return esParser(esCode);
  }

  private getTargetTSNodes(sourceFile: SourceFile): Node[] {
    const nodes: Node[] = [];

    function walk(node: Node): void {
      switch (node.kind) {
        case ts.SyntaxKind.ClassDeclaration:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.PropertyDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor:
        case ts.SyntaxKind.FunctionDeclaration:
          nodes.push(node);
          break;
        default:
      }

      ts.forEachChild(node, walk);
    }

    walk(sourceFile);

    return nodes;
  }

  private getJSDocNode(node) {
    if (!node.jsDoc) return null;

    return node.jsDoc[node.jsDoc.length - 1];
  }

  private transpileComment(node: Node, comment, code): string {
    const esNode = { type: 'CommentBlock', value: `*\n${comment}` };
    const tags = CommentParser.parse(esNode);

    this.applyLOC(node, tags, code);

    switch (node.kind) {
      case ts.SyntaxKind.ClassDeclaration:
        // do nothing
        break;
      case ts.SyntaxKind.MethodDeclaration:
        this.applyCallableParam(node, tags);
        this.applyCallableReturn(node, tags);
        break;
      case ts.SyntaxKind.PropertyDeclaration:
        this.applyClassProperty(node, tags);
        break;
      case ts.SyntaxKind.GetAccessor:
        this.applyClassMethodGetter(node, tags);
        break;
      case ts.SyntaxKind.SetAccessor:
        this.applyClassMethodSetter(node, tags);
        break;
      case ts.SyntaxKind.FunctionDeclaration:
        this.applyCallableParam(node, tags);
        this.applyCallableReturn(node, tags);
        break;
      default:
    }

    return `\n/*${CommentParser.buildComment(tags)} */\n`;
  }

  private applyLOC(node, tags, code): void {
    let loc = 1;
    const codeChars = [...code];
    for (let i = 0; i < node.name.end; i++) {
      if (codeChars[i] === '\n') loc++;
    }
    tags.push({ tagName: '@lineNumber', tagValue: `${loc}` });
  }

  private applyCallableParam(node, tags): void {
    const types = node.parameters.map(param => {
      return {
        type: this.getTypeFromAnnotation(param.type),
        name: param.name.text,
      };
    });

    const paramTags = tags.filter(tag => tag.tagName === '@param');

    // merge
    // case: params without comments
    if (paramTags.length === 0 && types.length) {
      const tmp = types.map(({ type, name }) => {
        return {
          tagName: '@param',
          tagValue: `{${type}} ${name}`,
        };
      });
      tags.push(...tmp);
      return;
    }

    // case: params with comments
    if (paramTags.length === types.length) {
      for (let i = 0; i < paramTags.length; i++) {
        const paramTag = paramTags[i];
        const type = types[i];
        if (paramTag.tagValue.charAt(0) !== '{') {
          // does not have type
          paramTag.tagValue = `{${type.type}} ${paramTag.tagValue}`;
        }
      }
      return;
    }

    // case: mismatch params and comments
    throw new Error('mismatch params and comments');
  }

  private applyCallableReturn(node, tags): void {
    if (!node.type) return;

    // get type
    const type = this.getTypeFromAnnotation(node.type);
    if (!type) return;

    // get comments
    const returnTag = tags.find(tag => tag.tagName === '@return' || tag.tagName === '@returns');

    // merge
    if (returnTag && returnTag.tagValue.charAt(0) !== '{') {
      // return with comment but does not have type
      returnTag.tagValue = `{${type}} ${returnTag.tagValue}`;
    } else {
      tags.push({ tagName: '@return', tagValue: `{${type}}` });
    }
  }

  private applyClassMethodGetter(node, tags): void {
    if (!node.type) return;

    // get type
    const type = this.getTypeFromAnnotation(node.type);
    if (!type) return;

    // get comments
    const typeComment = tags.find(tag => tag.tagName === '@type');

    if (typeComment && typeComment.tagValue.charAt(0) !== '{') {
      // type with comment but does not have tpe
      typeComment.tagValue = `{${type}}`;
    } else {
      tags.push({ tagName: '@type', tagValue: `{${type}}` });
    }
  }

  private applyClassMethodSetter(node, tags): void {
    if (!node.parameters) return;

    // get type
    const type = this.getTypeFromAnnotation(node.parameters[0].type);
    if (!type) return;

    // get comment
    const typeComment = tags.find(tag => tag.tagName === '@type');
    if (typeComment) return;

    // merge
    // case: param without comment
    tags.push({ tagName: '@type', tagValue: `{${type}}` });
  }

  private applyClassProperty(node, tags): void {
    if (!node.type) return;

    // get type
    const type = this.getTypeFromAnnotation(node.type);
    if (!type) return;

    // get comments
    const typeComment = tags.find(tag => tag.tagName === '@type');

    if (typeComment && typeComment.tagValue.charAt(0) !== '{') {
      // type with comment but does not have tpe
      typeComment.tagValue = `{${type}}`;
    } else {
      tags.push({ tagName: '@type', tagValue: `{${type}}` });
    }
  }

  private getTypeFromAnnotation(typeNode): string {
    if (!typeNode) {
      return 'undefined';
    }

    switch (typeNode.kind) {
      case ts.SyntaxKind.NumberKeyword:
        return 'number';
      case ts.SyntaxKind.StringKeyword:
        return 'string';
      case ts.SyntaxKind.BooleanKeyword:
        return 'boolean';
      case ts.SyntaxKind.TypeReference:
        return typeNode.typeName.text;
      default:
        return 'undefined';
    }
  }

  private transpileTS2ES(tsCode, esOption): string {
    const options = {
      module: ts.ModuleKind.ES2015,
      noResolve: true,
      target: ts.ScriptTarget.Latest,
      experimentalDecorators: esOption.decorators,
      jsx: esOption.jsx ? JsxEmit.Preserve : undefined,
    };

    const result = ts.transpileModule(tsCode, { compilerOptions: options });
    return result.outputText;
  }
}

export = new TypescriptPlugin();
