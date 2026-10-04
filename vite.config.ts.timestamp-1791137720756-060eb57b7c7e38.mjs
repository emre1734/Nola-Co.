// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.mjs";
import path from "path";
var __vite_injected_original_dirname = "/home/project";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "react-native": path.resolve(__vite_injected_original_dirname, "node_modules/react-native-web"),
      // Stub out native-only packages that can't work on web
      "react-native-safe-area-context": path.resolve(__vite_injected_original_dirname, "src/stubs/safe-area.ts"),
      "react-native-screens": path.resolve(__vite_injected_original_dirname, "src/stubs/screens.ts"),
      "react-native-gesture-handler": path.resolve(__vite_injected_original_dirname, "src/stubs/gesture-handler.ts"),
      "react-native-reanimated": path.resolve(__vite_injected_original_dirname, "src/stubs/reanimated.ts")
    },
    extensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".tsx",
      ".ts",
      ".jsx",
      ".js"
    ]
  },
  optimizeDeps: {
    include: ["react-native-web"],
    exclude: ["lucide-react"],
    esbuildOptions: {
      resolveExtensions: [".web.js", ".web.ts", ".web.tsx", ".js", ".ts", ".tsx"],
      define: {
        global: "window",
        __DEV__: "false"
      }
    }
  },
  define: {
    global: "window",
    __DEV__: JSON.stringify(process.env.NODE_ENV !== "production")
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdyZWFjdC1uYXRpdmUnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnbm9kZV9tb2R1bGVzL3JlYWN0LW5hdGl2ZS13ZWInKSxcbiAgICAgIC8vIFN0dWIgb3V0IG5hdGl2ZS1vbmx5IHBhY2thZ2VzIHRoYXQgY2FuJ3Qgd29yayBvbiB3ZWJcbiAgICAgICdyZWFjdC1uYXRpdmUtc2FmZS1hcmVhLWNvbnRleHQnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjL3N0dWJzL3NhZmUtYXJlYS50cycpLFxuICAgICAgJ3JlYWN0LW5hdGl2ZS1zY3JlZW5zJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9zdHVicy9zY3JlZW5zLnRzJyksXG4gICAgICAncmVhY3QtbmF0aXZlLWdlc3R1cmUtaGFuZGxlcic6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMvc3R1YnMvZ2VzdHVyZS1oYW5kbGVyLnRzJyksXG4gICAgICAncmVhY3QtbmF0aXZlLXJlYW5pbWF0ZWQnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnc3JjL3N0dWJzL3JlYW5pbWF0ZWQudHMnKSxcbiAgICB9LFxuICAgIGV4dGVuc2lvbnM6IFtcbiAgICAgICcud2ViLnRzeCcsICcud2ViLnRzJywgJy53ZWIuanN4JywgJy53ZWIuanMnLFxuICAgICAgJy50c3gnLCAnLnRzJywgJy5qc3gnLCAnLmpzJyxcbiAgICBdLFxuICB9LFxuICBvcHRpbWl6ZURlcHM6IHtcbiAgICBpbmNsdWRlOiBbJ3JlYWN0LW5hdGl2ZS13ZWInXSxcbiAgICBleGNsdWRlOiBbJ2x1Y2lkZS1yZWFjdCddLFxuICAgIGVzYnVpbGRPcHRpb25zOiB7XG4gICAgICByZXNvbHZlRXh0ZW5zaW9uczogWycud2ViLmpzJywgJy53ZWIudHMnLCAnLndlYi50c3gnLCAnLmpzJywgJy50cycsICcudHN4J10sXG4gICAgICBkZWZpbmU6IHtcbiAgICAgICAgZ2xvYmFsOiAnd2luZG93JyxcbiAgICAgICAgX19ERVZfXzogJ2ZhbHNlJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgZGVmaW5lOiB7XG4gICAgZ2xvYmFsOiAnd2luZG93JyxcbiAgICBfX0RFVl9fOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nKSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFvQjtBQUN0UCxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBSXpDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxnQkFBZ0IsS0FBSyxRQUFRLGtDQUFXLCtCQUErQjtBQUFBO0FBQUEsTUFFdkUsa0NBQWtDLEtBQUssUUFBUSxrQ0FBVyx3QkFBd0I7QUFBQSxNQUNsRix3QkFBd0IsS0FBSyxRQUFRLGtDQUFXLHNCQUFzQjtBQUFBLE1BQ3RFLGdDQUFnQyxLQUFLLFFBQVEsa0NBQVcsOEJBQThCO0FBQUEsTUFDdEYsMkJBQTJCLEtBQUssUUFBUSxrQ0FBVyx5QkFBeUI7QUFBQSxJQUM5RTtBQUFBLElBQ0EsWUFBWTtBQUFBLE1BQ1Y7QUFBQSxNQUFZO0FBQUEsTUFBVztBQUFBLE1BQVk7QUFBQSxNQUNuQztBQUFBLE1BQVE7QUFBQSxNQUFPO0FBQUEsTUFBUTtBQUFBLElBQ3pCO0FBQUEsRUFDRjtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFDLGtCQUFrQjtBQUFBLElBQzVCLFNBQVMsQ0FBQyxjQUFjO0FBQUEsSUFDeEIsZ0JBQWdCO0FBQUEsTUFDZCxtQkFBbUIsQ0FBQyxXQUFXLFdBQVcsWUFBWSxPQUFPLE9BQU8sTUFBTTtBQUFBLE1BQzFFLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLFNBQVM7QUFBQSxNQUNYO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLFFBQVE7QUFBQSxJQUNSLFNBQVMsS0FBSyxVQUFVLFFBQVEsSUFBSSxhQUFhLFlBQVk7QUFBQSxFQUMvRDtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
