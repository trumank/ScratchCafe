Scratch Café
============

A JS -> Scratch compiler

Example
-------

```javascript
// program.js
function add(n1, n2) {
    return n1 + n2;
}

function substring(string, start, end) {
    var result = '';
    for (var i = start; i < end; i++) {
        result += string[i];
    }
    return result;
}

var string = substring('hello world', 6, 11);
```

Usage:
------

Clone this repo:

    git clone https://github.com/MathWizz/ScratchCafe.git

Install acorn:

    npm install acorn

Run:

    node index.js