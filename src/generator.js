'use strict';

function* Counter() {
    let count = -1;
    while (true) {
        yield ++count;
    }
}

exports.propGenerator = () => {
    const counter = Counter();
    return counter;
};
