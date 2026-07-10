type NavigationEvent = {
  preventDefault: () => void;
};

type RegisterNavigationListener = (listener: (event: NavigationEvent) => void) => void;

type PreventNoteWindowNavigationOptions = {
  onWillNavigate: RegisterNavigationListener;
  onWillFrameNavigate: RegisterNavigationListener;
};

export function preventNoteWindowNavigation(options: PreventNoteWindowNavigationOptions): void {
  const preventNavigation = (event: NavigationEvent): void => {
    event.preventDefault();
  };

  options.onWillNavigate(preventNavigation);
  options.onWillFrameNavigate(preventNavigation);
}
