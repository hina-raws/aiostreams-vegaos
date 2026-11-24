import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';

describe('App', () => {
  it('shows the web client from the package assets', () => {
    const screen = render(<App />);
    const page = screen.getByTestId('aiostreams-page');
    expect(page.props.source).toEqual({uri: 'file:///pkg/assets/index.html'});
  });
});
