'use strict';

const alphabetArr = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
    'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't',
    'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C', 'D', 'E',
    'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '_'
];

// all alphabets, caps + small
const alph = [
    '_$a', '_$b', '_$c', '_$d', '_$e', '_$f', '_$g', '_$h', '_$i', '_$j',
    '_$k', '_$l', '_$m', '_$n', '_$o', '_$p', '_$q', '_$r', '_$s', '_$t',
    '_$u', '_$v', '_$w', '_$x', '_$y', '_$z', '_$A', '_$B', '_$C', '_$D', '_$E',
    '_$F', '_$G', '_$H', '_$I', '_$J', '_$K', '_$L', '_$M', '_$N', '_$O', '_$P',
    '_$Q', '_$R', '_$S', '_$T', '_$U', '_$V', '_$W', '_$X', '_$Y', '_$Z'
];

// numbers list 0-9
const numArr = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

// alphaNumeric array
const alphaNumArr = alphabetArr.concat(numArr);

const genForLargeGroups = (varNames) => {
    const temp = [];
    varNames.forEach(val => alphaNumArr.forEach(elem => temp.push(val + elem)));
    return varNames.concat(temp);
};

/**
 * Generates an array of var names based on the grouping size
 * For eg) if maxGroup is 3, it would generate an array of varNames
 * whose grouping size is 2. It would not exceed 2.
 * Doesn't maintain state.
 * Cannot be called incrementally.
 * @param {*} maxGroup the max size of the groupings
 */
const genVarsByGroupSize = (maxGroup) => {
    // if no maxGroup passed, just return
    if (!maxGroup) {
        console.error('Max Group size not found!');
        return;
    }
    // start with a grouping of 1
    let group = 1;
    // final result here
    let varNames = [];
    while (group <= maxGroup) {
        if (group === 1) {
            varNames = varNames.concat(alph);
        } else {
            varNames = genForLargeGroups(varNames);
        }
        group++;
    }
    return varNames;
};

module.exports = genVarsByGroupSize;
