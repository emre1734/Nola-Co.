import React from 'react';

export const SafeAreaProvider = ({ children }: { children: React.ReactNode }) =>
  React.createElement('div', { style: { flex: 1 } }, children);

export const SafeAreaView = ({ children, style }: any) =>
  React.createElement('div', { style }, children);

export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: 375, height: 812 });
export const initialWindowMetrics = null;
