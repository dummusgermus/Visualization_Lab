export function formatDateDisplay(dateString: string): string {
    const date = new Date(dateString);
    const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    return `${
        monthNames[date.getMonth()]
    } ${date.getDate()}, ${date.getFullYear()}`;
}
