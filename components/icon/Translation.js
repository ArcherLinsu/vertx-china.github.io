import React, { forwardRef } from "react"

const Translation = forwardRef(({ color = "currentColor", size = 24, ...rest }, ref) => {
    return (
        <svg
            ref={ref}
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...rest}
        >
            <path d="M2.5,5H10.5v5H2.5zM6.5,2v12zM17,11L13,21ZM17,11L21.5,21ZM14.4,17.5H19.925 ZM8.5,21H6.5A 3.2 3.2 90 0 1 3.2 17.6V16.6M15,4H17A 3.2 3.2 90 0 1 20.5 7V8" />
        </svg>
    )
})

Translation.displayName = "Translation"

export default Translation
