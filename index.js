var acorn = require('acorn'),
    fs = require('fs'),
    http = require('http'),
    util = require('util');

fs.readFile('program.js', function (e, data) {
    var parsed = acorn.parse(data).body;
    fs.writeFile("parse.js", util.inspect(parsed, {depth:null}));
    var built = buildRoot(parsed);
    console.log(util.inspect(built, {depth:null}));
    var project = {"objName":"Stage","variables":[],"lists":[],"scripts":[],"sounds":[],"costumes":[{"costumeName":"backdrop1","baseLayerID":-1,"baseLayerMD5":"510da64cf172d53750dffd23fbf73563.png","bitmapResolution":1,"rotationCenterX":240,"rotationCenterY":180}],"currentCostumeIndex":0,"penLayerMD5":"279467d0d49e152706ed66539b577c00.png","tempoBPM":60,"videoAlpha":0.5,"children":[],"info":{"videoOn":false,"spriteCount":0,"projectID":"10661193","flashVersion":"LNX 11,2,202,280","scriptCount":3,"userAgent":"Mozilla/5.0 (X11; Linux i686) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/27.0.1453.93 Safari/537.36"}};
    project.scripts = built.scripts;
    project.variables = built.variables;
    fs.writeFile("output.json", JSON.stringify(project), function(e) {
        console.log("Saved!");
    });
    upload(JSON.stringify(project));
});

function upload(data) {
    var req = http.request({
        hostname: 'scratch.mit.edu',
        port: 80,
        path: '/internalapi/project/10661193/set/',
        method: 'POST',
        headers: {
            Cookie: require('./cookie').c
        }
    });

    req.end(data);
}

function Scope(parent) {
    this.children = [];
    if (parent) {
        parent.addChild(this);
    }
    this.parent = parent;
    this.variables = {};
    this.parameters = {};
    this.functions = [];
    this.gobal = this.getGlobal();
    if (this === this.global) {
        this.allVariables = {};
    }
}

Scope.prototype = {
    getGlobal: function () {
        if (this.global) {
            return this.global;
        } else if (this.parent) {
            return this.global = this.parent.getGlobal();
        }
        return this.global = this;
    },
    addChild: function (child) {
        this.children.push(child);
    },
    export: function () {
        var self = this;
        var variables = [];
        Object.keys(this.allVariables).forEach(function (name) {
            var l = self.allVariables[name].id;
            for (var i = 1; i <= l; i++) {
                if (!self.allVariables[name].param) {
                    variables.push({
                        name: name + i,
                        value: 0, // not important
                        isPersistent: false
                    });
                }
            }
        });
        return variables;
    },
    addFunction: function (name, spec) {
        if (this !== this.global) {
            this.global.addFunction(name, spec);
            return;
        }
        this.functions[name] = spec;
    },
    getFunction: function (spec) {
        return this.functions[spec] || (this.parent && this.parent.getFunction(spec));
    },
    getName: function (name) {
        return this.variables[name] || (this.parent && this.parent.getName(name));
    },
    getParam: function (name) {
        return this.parameters[name] || (this.parent && this.parent.getParam(name));
    },
    getUnique: function (name) {
        return this.variables[name] = this.global.getNext(name);
    },
    getUniqueParam: function (name) {
        return this.parameters[name] = this.global.getNext(name, true);
    },
    getNext: function (name, param) {
        var v = this.allVariables[name];
        if (!v) {
            v = this.allVariables[name] = {id: 0, param: param};
        }
        return name + ++v.id;
    }
};

var types = {
    AssignmentExpression: function (obj, scope, seq) {
        seq.push(['setVar:to:', scope.getName(obj.left.name), ['concatenate:with:', build(obj.left, scope, seq), build(obj.right, scope, seq)]]);
    },
    BinaryExpression: function (obj, scope, seq) {
        return [obj.operator, build(obj.left, scope, seq), build(obj.right, scope, seq)];
    },
    BlockStatement: function (obj, scope, seq) {
        seq = seq || [];
        obj.body.forEach(function (exp) {
            build(exp, scope, seq);
        });
        return seq;
    },
    CallExpression: function (obj, scope, seq) {
        var block = ['call', scope.getFunction(obj.callee.name)];
        obj.arguments.forEach(function (arg) {
            block.push(build(arg, scope, seq));
        });
        seq.push(block);
        return ['readVariable', 'return'];
    },
    ExpressionStatement: function (obj, scope, seq) {
        return build(obj.expression, scope, seq);
    },
    ForStatement: function (obj, scope, seq) {
        var newScope = new Scope(scope);
        build(obj.init, newScope, seq);
        var conditionSeq = [];
        var condition = build(obj.test, newScope, conditionSeq);
        var bodySeq = [];
        build(obj.body, newScope, bodySeq);
        build(obj.update, newScope, bodySeq);
        conditionSeq.forEach(function (block) {
            seq.add(block);
            bodySeq.add(block);
        });
        seq.push(['doUntil', ['not', condition], bodySeq]);
    },
    FunctionDeclaration: function (obj, scope, seq) {
        var newScope = new Scope(scope);
        var spec = obj.id.name + ' ' + obj.params.map(function (param) {
            return '%s';
        }).join(' ');
        var params = obj.params.map(function (param) {
            return newScope.getUniqueParam(param.name);
        });
        scope.addFunction(obj.id.name, spec);
        seq.push(['procDef', spec, params, params, false]);
        build(obj.body, newScope, seq);
    },
    Identifier: function (obj, scope, seq) {
        var name = scope.getName(obj.name);
        if (name) {
            return ['readVariable', name];
        }
        return ['getParam', scope.getParam(obj.name), 'r'];
    },
    Literal: function (obj, scope, seq) {
        return obj.value;
    },
    MemberExpression: function (obj, scope, seq) {
        return ['letter:of:', ['+', build(obj.property, scope, seq), 1], build(obj.object, scope, seq)];
    },
    ReturnStatement: function (obj, scope, seq) {
        seq.push(['setVar:to:', 'return', build(obj.argument, scope, seq)]);
    },
    UpdateExpression: function (obj, scope, seq) {
        var delta = {'++':1,'--':-1}[obj.operator];
        seq.push(['changeVar:by:', scope.getName(obj.argument.name), delta]);
        return obj.prefix ? build(obj.argument, scope, seq) : ['-', build(obj.argument, scope, seq), delta];
    },
    VariableDeclaration: function (obj, scope, seq) {
        obj.declarations.forEach(function (exp) {
            build(exp, scope, seq);
        })
    },
    VariableDeclarator: function (obj, scope, seq) {
        seq.push(['setVar:to:', scope.getUnique(obj.id.name), build(obj.init, scope, seq)]);
    }
};

function buildRoot(obj) {
    var scope = new Scope();
    var scripts = obj.map(function (exp) {
        var seq = [];
        build(exp, scope, seq);
        return [50, 50, seq];
    });
    return {
        variables: scope.export(),
        scripts: scripts
    };
}

function build(obj, scope, seq) {
    return types[obj.type](obj, scope, seq);
}
