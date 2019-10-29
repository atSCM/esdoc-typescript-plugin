"use strict";
/* eslint-disable no-param-reassign */
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const path = __importStar(require("path"));
const typescript_1 = __importStar(require("typescript"));
const CommentParser_1 = __importDefault(require("esdoc/out/src/Parser/CommentParser")); // eslint-disable-line import/no-unresolved
class TypescriptPlugin {
    constructor() {
        this.enabled = true;
    }
    onStart(ev) {
        if (!ev.data.option)
            return;
        if ('enable' in ev.data.option)
            this.enabled = ev.data.option.enable;
    }
    onHandleConfig(ev) {
        if (!this.enabled)
            return;
        if (!ev.data.config.includes)
            ev.data.config.includes = [];
        ev.data.config.includes.push('\\.ts$', '\\.js$');
    }
    onHandleCodeParser(ev) {
        if (!this.enabled)
            return;
        const esParser = ev.data.parser;
        const esParserOption = ev.data.parserOption;
        const filePath = ev.data.filePath;
        ev.data.parser = (code) => this.tsParser(esParser, esParserOption, filePath, code);
    }
    // https://github.com/Microsoft/TypeScript/blob/master/src/services/transpile.ts#L26
    tsParser(esParser, esParserOption, filePath, code) {
        // return if not typescript
        if (path.extname(filePath) !== '.ts')
            return esParser(code);
        // create ast and get target nodes
        const sourceFile = typescript_1.default.createSourceFile(filePath, code, typescript_1.default.ScriptTarget.Latest, true);
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
    getTargetTSNodes(sourceFile) {
        const nodes = [];
        function walk(node) {
            switch (node.kind) {
                case typescript_1.default.SyntaxKind.ClassDeclaration:
                case typescript_1.default.SyntaxKind.MethodDeclaration:
                case typescript_1.default.SyntaxKind.PropertyDeclaration:
                case typescript_1.default.SyntaxKind.GetAccessor:
                case typescript_1.default.SyntaxKind.SetAccessor:
                case typescript_1.default.SyntaxKind.FunctionDeclaration:
                    nodes.push(node);
                    break;
                default:
            }
            typescript_1.default.forEachChild(node, walk);
        }
        walk(sourceFile);
        return nodes;
    }
    getJSDocNode(node) {
        if (!node.jsDoc)
            return null;
        return node.jsDoc[node.jsDoc.length - 1];
    }
    transpileComment(node, comment, code) {
        const esNode = { type: 'CommentBlock', value: `*\n${comment}` };
        const tags = CommentParser_1.default.parse(esNode);
        this.applyLOC(node, tags, code);
        switch (node.kind) {
            case typescript_1.default.SyntaxKind.ClassDeclaration:
                // do nothing
                break;
            case typescript_1.default.SyntaxKind.MethodDeclaration:
                this.applyCallableParam(node, tags);
                this.applyCallableReturn(node, tags);
                break;
            case typescript_1.default.SyntaxKind.PropertyDeclaration:
                this.applyClassProperty(node, tags);
                break;
            case typescript_1.default.SyntaxKind.GetAccessor:
                this.applyClassMethodGetter(node, tags);
                break;
            case typescript_1.default.SyntaxKind.SetAccessor:
                this.applyClassMethodSetter(node, tags);
                break;
            case typescript_1.default.SyntaxKind.FunctionDeclaration:
                this.applyCallableParam(node, tags);
                this.applyCallableReturn(node, tags);
                break;
            default:
        }
        return `\n/*${CommentParser_1.default.buildComment(tags)} */\n`;
    }
    applyLOC(node, tags, code) {
        let loc = 1;
        const codeChars = [...code];
        for (let i = 0; i < node.name.end; i++) {
            if (codeChars[i] === '\n')
                loc++;
        }
        tags.push({ tagName: '@lineNumber', tagValue: `${loc}` });
    }
    applyCallableParam(node, tags) {
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
    applyCallableReturn(node, tags) {
        if (!node.type)
            return;
        // get type
        const type = this.getTypeFromAnnotation(node.type);
        if (!type)
            return;
        // get comments
        const returnTag = tags.find(tag => tag.tagName === '@return' || tag.tagName === '@returns');
        // merge
        if (returnTag && returnTag.tagValue.charAt(0) !== '{') {
            // return with comment but does not have type
            returnTag.tagValue = `{${type}} ${returnTag.tagValue}`;
        }
        else {
            tags.push({ tagName: '@return', tagValue: `{${type}}` });
        }
    }
    applyClassMethodGetter(node, tags) {
        if (!node.type)
            return;
        // get type
        const type = this.getTypeFromAnnotation(node.type);
        if (!type)
            return;
        // get comments
        const typeComment = tags.find(tag => tag.tagName === '@type');
        if (typeComment && typeComment.tagValue.charAt(0) !== '{') {
            // type with comment but does not have tpe
            typeComment.tagValue = `{${type}}`;
        }
        else {
            tags.push({ tagName: '@type', tagValue: `{${type}}` });
        }
    }
    applyClassMethodSetter(node, tags) {
        if (!node.parameters)
            return;
        // get type
        const type = this.getTypeFromAnnotation(node.parameters[0].type);
        if (!type)
            return;
        // get comment
        const typeComment = tags.find(tag => tag.tagName === '@type');
        if (typeComment)
            return;
        // merge
        // case: param without comment
        tags.push({ tagName: '@type', tagValue: `{${type}}` });
    }
    applyClassProperty(node, tags) {
        if (!node.type)
            return;
        // get type
        const type = this.getTypeFromAnnotation(node.type);
        if (!type)
            return;
        // get comments
        const typeComment = tags.find(tag => tag.tagName === '@type');
        if (typeComment && typeComment.tagValue.charAt(0) !== '{') {
            // type with comment but does not have tpe
            typeComment.tagValue = `{${type}}`;
        }
        else {
            tags.push({ tagName: '@type', tagValue: `{${type}}` });
        }
    }
    getTypeFromAnnotation(typeNode) {
        if (!typeNode) {
            return 'undefined';
        }
        switch (typeNode.kind) {
            case typescript_1.default.SyntaxKind.NumberKeyword:
                return 'number';
            case typescript_1.default.SyntaxKind.StringKeyword:
                return 'string';
            case typescript_1.default.SyntaxKind.BooleanKeyword:
                return 'boolean';
            case typescript_1.default.SyntaxKind.TypeReference:
                return typeNode.typeName.text;
            default:
                return 'undefined';
        }
    }
    transpileTS2ES(tsCode, esOption) {
        const options = {
            module: typescript_1.default.ModuleKind.ES2015,
            noResolve: true,
            target: typescript_1.default.ScriptTarget.Latest,
            experimentalDecorators: esOption.decorators,
            jsx: esOption.jsx ? typescript_1.JsxEmit.Preserve : undefined,
        };
        const result = typescript_1.default.transpileModule(tsCode, { compilerOptions: options });
        return result.outputText;
    }
}
module.exports = new TypescriptPlugin();
