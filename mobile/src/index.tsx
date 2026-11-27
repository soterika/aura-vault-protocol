import { registerRootComponent } from "expo";
import React from "react";
import { AppNavigator } from "./navigation/AppNavigator";

export default function App() {
  return <AppNavigator />;
}

registerRootComponent(App);
