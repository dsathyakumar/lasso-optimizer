// all alphabets, caps + small
const alphabetArr = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 
    'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 
    'u', 'v', 'w', 'x', 'y', 'z','A','B','C', 'D', 'E', 
    'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 
    'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '_', '$'
];
// numbers list 0-9
const numArr = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

// alphaNumeric array
const alphaNumArr = alphabetArr.concat(numArr);

/**
 * Generates an array of class names based on the grouping size
 * For eg) if maxGroup is 3, it would generate an array of classNames
 * whose grouping size is 2. It would not exceed 2.
 * Doesn't maintain state. 
 * Cannot be called incrementally.
 * @param {*} maxGroup the max size of the groupings
 */
const genClassesByGroupSize = (maxGroup) => {
    // if no maxGroup passed, just return
    if (!maxGroup) {
        console.error('Max Group size not found!');
        return;
    }
    // start with a grouping of 1
    let group = 1;
    // final result here
    let classNames = [];
    while (group <= maxGroup) {
        let temp = [];
        classNames = (group === 1) ? classNames.concat(alphabetArr) : (() => {
            classNames.forEach((val, idx) => {
                return alphaNumArr.forEach((elem) => {
                    temp.push(val + elem);
                });
            });
            return classNames.concat(temp);
        })();
        group++;
    }
    return classNames;
}

function* yieldArray(arr) {
    yield* arr
}

exports.propGenerator = maxSize => {
    const arr = genClassesByGroupSize(maxSize);
    return yieldArray(arr);
};
