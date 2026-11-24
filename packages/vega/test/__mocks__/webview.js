const React = require('react');
const {View} = require('react-native');

module.exports = {
  WebView: React.forwardRef((props, ref) =>
    React.createElement(View, {...props, ref}),
  ),
};
