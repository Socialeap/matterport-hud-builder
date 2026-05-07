I’ll fix the slideshow in `src/components/HeroSlideshow.tsx`, which is shared by both `/` and `/agents`, so both hero sections update together.

## Plan

1. **Make each slide hold longer**
   - Increase `INTERVAL_MS` from `4000` to `7000` milliseconds.
   - This adds the requested 3 seconds per slide while keeping the existing quick `500ms` fade transition.

2. **Prevent the browser bar from covering the top of the image**
   - Keep the browser chrome title bar in the route files unchanged.
   - Adjust the slideshow image rendering so the image content starts lower inside the slideshow area and is not cropped behind/against the browser bar.
   - Use a small top padding inside the slideshow container plus `object-contain` instead of `object-cover`, so the full top of each source image remains visible instead of being cropped.
   - Add a dark/black background behind the contained image so any padding or letterboxing blends into the existing browser frame.

3. **Verify both pages inherit the fix**
   - Confirm `/` and `/agents` both use the same `<HeroSlideshow />` component, so no duplicate timing/layout changes are needed in the route files.
   - After implementation, visually inspect the hero frame to ensure the browser bar no longer hides the top of the slide content.