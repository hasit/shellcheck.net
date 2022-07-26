/* Apply ShellCheck fixes to code.
 *
 * This specific file, autofix.js, is released into the public domain.
 * Please feel free to use it however you see fit.
 */


function AutoFixer(file) {
  // Apply a list of fixes (either comments or their .fix values).
  // Returns an object with .applied and .rejected fixes.
  function applyFixes(fixlist) {
    var result = {
      applied: [],
      rejected: [],
    };
    for (var fix of fixlist) {
      if (this.applyFix(fix)) {
        result.applied.push(fix);
      } else {
        result.rejected.push(fix);
      }
    }

    return result;
  }

  // Try to apply a single fix. Return true if it could be applied (without conflicting with previous ones).
  function applyFix(item) {
    var fix = item;
    var candidates = [];

    if(!fix) {
      return false;
    }

    if (fix.fix) {
      // If this is a comment, grab the fix instead.
      fix = fix.fix;
    }

    // Who knows what this is...
    if(!fix || fix.replacements === undefined) {
      return false;
    }

    // TODO: Make this less quadratic
    for (var rep of fix.replacements) {
      var candidate = {
        start: getOffsetFor.call(this, rep.line, rep.column),
        end: getOffsetFor.call(this, rep.endLine, rep.endColumn),
        startLine: rep.line,
        endLine: rep.endLine,
        precedence: rep.precedence,
        point: rep.insertionPoint,
        text: rep.replacement,
      };
      candidates.push(candidate);

      for (var existing of this._replacements) {
        if (candidate.end > existing.start && existing.end > candidate.start) {
          return false;
        }
      }
    }

    this._replacements = this._replacements.concat(candidates);
    return true;
  }

  // Get the file with relevant fixes applied.
  function getResult() {
    this._replacements.sort(function (a,b) {
      return b.precedence - a.precedence;
    });
    var tree = new PrefixSumTree();
    var file = this._file;

    for (var rep of [...this._replacements].reverse()) {
      file = applyReplacement(file, tree, rep);
    }
    return file;
  }

  // Get the parts of the file from first to last affected line.
  function getSnippet() {
    if(this._replacements.length == 0) {
      throw new Error("No fixes have been applied.");
    }

    this._replacements.sort(function (a,b) {
      return b.precedence - a.precedence;
    });

    var tree = new PrefixSumTree();
    var file = this._file;
    var minLine = this._replacements[0].startLine;
    var maxLine = this._replacements[0].endLine;


    for (var rep of [...this._replacements].reverse()) {
      file = applyReplacement(file, tree, rep);
      minLine = Math.min(minLine, rep.startLine);
      maxLine = Math.max(maxLine, rep.endLine);
    }

    // Get offset of the minimal line
    var startOffset = this._lineOffsets[minLine-1];
    // Get offset up to and including the last line
    var endOffset = this._lineOffsets[maxLine];
    // Adjust end offset. The start offset should never need adjustment
    // because all fixes happened on/after it.
    endOffset += tree.lookup(endOffset);

    return file.substring(startOffset, endOffset);
  }

  // Compute the character offset of the start of each line in the file.
  function getLineOffsets(lines) {
    var sum = 0;
    var offsets = [];
    for (var i=0; i<lines.length; i++) {
      offsets[i] = sum;
      sum += lines[i].length + 1;
    }
    offsets[i] = sum;
    return offsets;
  }

  // ShellCheck operates with standard 8 column tab stops.
  // Realign them to 1, so that a '\t' is a single character.
  // Return the new column number.
  function adjustTabStops(lineNo, columnNo) {
    // ShellCheck operates with editor style 1-based line numbering
    var line = this._lines[lineNo-1];
    var tabstop = 8;

    var logical = 0;
    var physical = 0;
    for(var i=0, e=line.length; i < e; i++) {
      if(line[i] === '\t') {
        logical += tabstop - (logical % tabstop);
      } else {
        logical++;
      }

      if (columnNo <= logical) {
        return i+1;
      }
    }
    // The original fix was invalid...
    return i+1;
  }

  // Get the offset into the original file, 0-indexed
  function getOffsetFor(line, col) {
    return this._lineOffsets[line-1] + adjustTabStops.call(this, line, col) - 1;
  }

  // Apply a single replacement. The highest precedence ones should be applied first.
  // Note that these refer to replacements as generated by `applyFixes`, and not raw json.
  function applyReplacement(file, tree, rep) {
    // Get the offset into the original file
    var from = rep.start;
    var to   = rep.end;
    // Get offset into the current state of the modified file
    from += tree.lookup(from);
    to += tree.lookup(to);

    file = file.substring(0, from) + rep.text + file.substring(to);

    var point;
    if (rep.point == "beforeStart") {
      point = rep.start;
    } else if(rep.point == "afterEnd") {
      point = rep.end + 1;
    } else {
      throw new Error("Unrecognized insertion point " + rep.point);
    }
    tree.insert(point, rep.text.length - (to-from));
    return file;
  }

  function PrefixSumTree() {
    function insert(node, point, value) {
      do {
        if (point < node.pivot) {
          node.sumLeft += value;
          if (!node.left) {
            node.left = {
              pivot: point,
              sumLeft: value,
            };
            return;
          }
          node = node.left;
        } else if (point > node.pivot) {
          if (!node.right) {
            node.right = {
              pivot: point,
              sumLeft: value,
            };
            return;
          }
          node = node.right;
        } else {
          node.sumLeft += value;
          return;
        }
      } while(true);
    }

    function lookup(node, point) {
      var sum = 0;
      do {
        if (point < node.pivot) {
          node = node.left;
        } else if (point > node.pivot) {
          sum += node.sumLeft;
          node = node.right;
        } else {
          sum += node.sumLeft;
          node = null;
        }
      } while(node);
      return sum;
    }

    return {
      tree: {
        pivot: 0,
        sumLeft: 0,
      },

      insert: function(point, value) {
        return insert(this.tree, point, value);
      },

      lookup: function(point) {
        return lookup(this.tree, point);
      },

      reset: function () {
        this.tree = { pivot: 0, sumLeft: 0 };
      }
    }
  }

  var lines = file.split("\n");
  return {
    _file: file,
    _lines: lines,
    _lineOffsets: getLineOffsets(lines),
    _replacements: [],

    applyFix: applyFix,
    applyFixes: applyFixes,
    getResult: getResult,
    getSnippet: getSnippet,
    hasModifications: function() {
      return this._replacements.length > 0;
    },
    reset: function() {
      this._replacements = [];
    }
  }
}


function autofixTest() {
  function assertEqual(expected, actual) {
    if(expected != actual) {
      throw ("Failed to apply fixes: " + expected + " != " + actual);
    }
  }

  function test(initial, expected, fixes) {
    var fixer = new AutoFixer(initial);
    fixer.applyFixes(fixes);
    var actual = fixer.getResult();
    assertEqual(expected, actual);
  };

  test("cd $1", "cd \"$1\" || exit", [
    {
      "file": "-",
      "line": 1,
      "endLine": 1,
      "column": 1,
      "endColumn": 6,
      "level": "warning",
      "code": 2164,
      "message": "Use 'cd ... || exit' or 'cd ... || return' in case cd fails.",
      "fix": {
        "replacements": [
          {
            "line": 1,
            "endLine": 1,
            "precedence": 5,
            "insertionPoint": "beforeStart",
            "column": 6,
            "replacement": " || exit",
            "endColumn": 6
          }
        ]
      }
    },
    {
      "file": "-",
      "line": 1,
      "endLine": 1,
      "column": 4,
      "endColumn": 6,
      "level": "info",
      "code": 2086,
      "message": "Double quote to prevent globbing and word splitting.",
      "fix": {
        "replacements": [
          {
            "line": 1,
            "endLine": 1,
            "precedence": 7,
            "insertionPoint": "afterEnd",
            "column": 4,
            "replacement": "\"",
            "endColumn": 4
          },
          {
            "line": 1,
            "endLine": 1,
            "precedence": 7,
            "insertionPoint": "beforeStart",
            "column": 6,
            "replacement": "\"",
            "endColumn": 6
          }
        ]
      }
    }
  ]);

  test("\t\tfoo bar\n\t\techo $var:\t$value", "\t\tfoo bar\n\t\techo \"$var\":\t\"$value\"", [
    {
      "file": "-",
      "line": 2,
      "endLine": 2,
      "column": 33,
      "endColumn": 39,
      "level": "info",
      "code": 2086,
      "message": "Double quote to prevent globbing and word splitting.",
      "fix": {
        "replacements": [
          {
            "line": 2,
            "endLine": 2,
            "precedence": 7,
            "insertionPoint": "afterEnd",
            "column": 33,
            "replacement": "\"",
            "endColumn": 33
          },
          {
            "line": 2,
            "endLine": 2,
            "precedence": 7,
            "insertionPoint": "beforeStart",
            "column": 39,
            "replacement": "\"",
            "endColumn": 39
          }
        ]
      }
    },
    {
      "file": "-",
      "line": 2,
      "endLine": 2,
      "column": 22,
      "endColumn": 26,
      "level": "info",
      "code": 2086,
      "message": "Double quote to prevent globbing and word splitting.",
      "fix": {
        "replacements": [
          {
            "line": 2,
            "endLine": 2,
            "precedence": 7,
            "insertionPoint": "afterEnd",
            "column": 22,
            "replacement": "\"",
            "endColumn": 22
          },
          {
            "line": 2,
            "endLine": 2,
            "precedence": 7,
            "insertionPoint": "beforeStart",
            "column": 26,
            "replacement": "\"",
            "endColumn": 26
          }
        ]
      }
    }
  ]);


  var fixer = new AutoFixer('foo\ncd foo\nbar\n');
  fixer.applyFix(
    {
      "replacements": [
        {
          "line": 2,
          "endLine": 2,
          "precedence": 5,
          "insertionPoint": "beforeStart",
          "column": 7,
          "replacement": " || exit",
          "endColumn": 7
        }
      ]
    });
  assertEqual("cd foo || exit\n", fixer.getSnippet());
  return true;
}
