declare module 'react-native' {
  export type ViewStyle = Omit<import('react').CSSProperties, 'opacity' | 'transform'> & {
    [key: string]: unknown;
    opacity?: number | Animated.Value;
    elevation?: number;
    shadowColor?: string;
    shadowOffset?: { width: number; height: number };
    shadowOpacity?: number;
    shadowRadius?: number;
    textAlignVertical?: 'auto' | 'top' | 'bottom' | 'center';
    transform?: import('react').CSSProperties['transform'] | readonly Transform[];
  };

  export type TextStyle = ViewStyle;
  export type ImageStyle = ViewStyle;
  export type StyleProp<T> = T | readonly StyleProp<T>[] | false | null | undefined;

  export interface TextInputProps
    extends Omit<import('react').InputHTMLAttributes<HTMLInputElement>, 'style' | 'onChange' | 'onFocus' | 'onBlur' | 'value' | 'autoCorrect'> {
    style?: StyleProp<TextStyle>;
    value?: string;
    onChangeText?: (text: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholderTextColor?: string;
    secureTextEntry?: boolean;
    multiline?: boolean;
    numberOfLines?: number;
    textAlignVertical?: 'auto' | 'top' | 'bottom' | 'center';
    keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric' | 'number-pad' | 'decimal-pad';
    autoCorrect?: boolean;
    returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send' | 'none';
    editable?: boolean;
    [key: string]: unknown;
  }

  export interface NativeScrollEvent {
    contentOffset: { x: number; y: number };
  }

  export interface ViewProps {
    children?: import('react').ReactNode;
    style?: StyleProp<ViewStyle>;
    pointerEvents?: 'auto' | 'box-none' | 'box-only' | 'none' | string;
  }

  export interface TextProps {
    children?: import('react').ReactNode;
    style?: StyleProp<TextStyle>;
    numberOfLines?: number;
    onPress?: (event: { stopPropagation?: () => void }) => void;
  }

  export interface TouchableOpacityProps {
    children?: import('react').ReactNode;
    style?: StyleProp<ViewStyle>;
    onPress?: () => void;
    disabled?: boolean;
    activeOpacity?: number;
  }

  export interface ScrollViewProps {
    children?: import('react').ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
    horizontal?: boolean;
    pagingEnabled?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    showsVerticalScrollIndicator?: boolean;
    onScroll?: (event: { nativeEvent: NativeScrollEvent }) => void;
    scrollEventThrottle?: number;
    contentOffset?: { x: number; y: number };
    keyboardShouldPersistTaps?: 'always' | 'never' | 'handled';
    refreshControl?: import('react').ReactElement;
  }

  export interface ImageProps {
    source: { uri: string } | number;
    style?: StyleProp<ImageStyle>;
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
  }

  export interface RefreshControlProps {
    refreshing?: boolean;
    onRefresh?: () => void;
    tintColor?: string;
    colors?: readonly string[];
  }

  export interface KeyboardAvoidingViewProps extends ViewProps {
    behavior?: 'height' | 'position' | 'padding';
    keyboardVerticalOffset?: number;
  }

  export interface ActivityIndicatorProps {
    color?: string;
    size?: 'small' | 'large' | number;
  }

  export interface ModalProps {
    children?: import('react').ReactNode;
    visible?: boolean;
    transparent?: boolean;
    animationType?: 'none' | 'slide' | 'fade';
    onRequestClose?: () => void;
  }

  export interface SwitchProps {
    value?: boolean;
    onValueChange?: (value: boolean) => void;
    disabled?: boolean;
    trackColor?: { false?: string; true?: string };
    thumbColor?: string;
  }

  export interface Transform {
    scale?: number | Animated.Value;
    rotate?: string | Animated.Value;
  }

  export const View: import('react').ComponentType<ViewProps>;
  export const SafeAreaView: import('react').ComponentType<ViewProps>;
  export const Text: import('react').ComponentType<TextProps>;
  export const TouchableOpacity: import('react').ComponentType<TouchableOpacityProps>;
  export const TouchableWithoutFeedback: import('react').ComponentType<TouchableOpacityProps>;
  export const RefreshControl: import('react').ComponentType<RefreshControlProps>;
  export const KeyboardAvoidingView: import('react').ComponentType<KeyboardAvoidingViewProps>;
  export const ScrollView: import('react').ComponentType<ScrollViewProps>;
  export const TextInput: import('react').ComponentType<TextInputProps>;
  export const Image: import('react').ComponentType<ImageProps>;
  export const ActivityIndicator: import('react').ComponentType<ActivityIndicatorProps>;
  export const Modal: import('react').ComponentType<ModalProps>;
  export const Switch: import('react').ComponentType<SwitchProps>;

  export const StyleSheet: {
    create<T extends Record<string, ViewStyle>>(styles: T): T;
  };

  export const Dimensions: {
    get(dimension: 'window' | 'screen'): { width: number; height: number; scale: number; fontScale: number };
  };

  export const Platform: {
    OS: 'web' | 'ios' | 'android' | 'windows' | 'macos';
  };

  export const Linking: {
    openURL(url: string): Promise<unknown>;
  };

  export const Easing: {
    linear: (value: number) => number;
    inOut: (easing: (value: number) => number) => (value: number) => number;
  };

  export namespace Animated {
    class Value {
      constructor(value: number);
      setValue(value: number): void;
      interpolate(config: { inputRange: readonly number[]; outputRange: readonly string[] }): Value;
    }

    interface Animation {
      start(callback?: () => void): void;
    }

    const View: import('react').ComponentType<ViewProps>;
    function timing(value: Value, config: { toValue: number; duration: number; delay?: number; useNativeDriver: boolean; easing?: (value: number) => number }): Animation;
    function spring(value: Value, config: { toValue: number; useNativeDriver: boolean; tension?: number; friction?: number }): Animation;
    function sequence(animations: readonly Animation[]): Animation;
    function parallel(animations: readonly Animation[]): Animation;
    function loop(animation: Animation): Animation;
  }
}
