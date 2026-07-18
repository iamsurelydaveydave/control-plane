export default defineAppConfig({
  ui: {
    colors: {
      neutral: 'neutral'
    },
    // App-wide default button size
    button: {
      defaultVariants: {
        size: 'lg'
      }
    },
    // App-wide default input size - comfortably tap-sized
    input: {
      defaultVariants: {
        size: 'xl'
      }
    },
    textarea: {
      defaultVariants: {
        size: 'xl'
      }
    },
    select: {
      defaultVariants: {
        size: 'xl'
      }
    },
    selectMenu: {
      defaultVariants: {
        size: 'xl'
      }
    },
    inputMenu: {
      defaultVariants: {
        size: 'xl'
      }
    },
    inputNumber: {
      defaultVariants: {
        size: 'xl'
      }
    },
    // Dialog/modal footer alignment
    modal: {
      slots: {
        footer: 'justify-end'
      }
    },
    slideover: {
      slots: {
        footer: 'justify-end'
      }
    }
  }
})
