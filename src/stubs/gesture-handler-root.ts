import React from 'react';
import { View } from 'react-native';
export const GestureHandlerRootView = ({ children, style }: any) =>
  React.createElement(View, { style }, children);
